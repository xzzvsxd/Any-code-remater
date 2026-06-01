use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JsonlLineWindow {
    pub lines: Vec<String>,
    pub selected_line_count: usize,
    pub has_more_before: bool,
}

pub fn read_jsonl_line_window_from_end<P: AsRef<Path>>(
    path: P,
    offset_from_end: usize,
    limit: usize,
) -> io::Result<JsonlLineWindow> {
    if limit == 0 {
        return Ok(JsonlLineWindow {
            lines: Vec::new(),
            selected_line_count: 0,
            has_more_before: false,
        });
    }

    let mut file = File::open(path)?;
    let file_len = file.metadata()?.len();
    if file_len == 0 {
        return Ok(JsonlLineWindow {
            lines: Vec::new(),
            selected_line_count: 0,
            has_more_before: false,
        });
    }

    const CHUNK_SIZE: usize = 64 * 1024;
    let needed_lines = offset_from_end.saturating_add(limit).saturating_add(1);
    let mut cursor = file_len;
    let mut suffix: Vec<u8> = Vec::new();
    let mut newest_to_oldest: Vec<String> = Vec::new();
    let mut is_last_chunk = true;

    while cursor > 0 && newest_to_oldest.len() < needed_lines {
        let read_size = (cursor as usize).min(CHUNK_SIZE);
        cursor -= read_size as u64;

        file.seek(SeekFrom::Start(cursor))?;
        let mut chunk = vec![0u8; read_size];
        file.read_exact(&mut chunk)?;
        chunk.extend_from_slice(&suffix);

        let parts: Vec<&[u8]> = chunk.split(|byte| *byte == b'\n').collect();
        let first_complete_part = if cursor == 0 { 0 } else { 1 };

        for part_index in (first_complete_part..parts.len()).rev() {
            let part = parts[part_index];

            // A final newline creates an empty split segment at EOF. It is not
            // a JSONL record and must not count toward offsets.
            if is_last_chunk && part_index == parts.len() - 1 && part.is_empty() {
                continue;
            }

            // Empty physical lines are ignored consistently with the JSONL
            // parsers in the session-history commands.
            if part.is_empty() {
                continue;
            }

            newest_to_oldest.push(String::from_utf8_lossy(part).into_owned());
            if newest_to_oldest.len() >= needed_lines {
                break;
            }
        }

        if cursor > 0 {
            suffix = parts.first().map(|part| part.to_vec()).unwrap_or_default();
        }

        is_last_chunk = false;
    }

    let has_more_before = newest_to_oldest.len() > offset_from_end.saturating_add(limit);
    let mut lines = newest_to_oldest
        .into_iter()
        .skip(offset_from_end)
        .take(limit)
        .collect::<Vec<_>>();
    let selected_line_count = lines.len();
    lines.reverse();

    Ok(JsonlLineWindow {
        lines,
        selected_line_count,
        has_more_before,
    })
}

#[cfg(test)]
mod tests {
    use super::read_jsonl_line_window_from_end;
    use std::io::Write;

    fn write_temp_jsonl(lines: &[&str], trailing_newline: bool) -> tempfile::NamedTempFile {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        for (index, line) in lines.iter().enumerate() {
            if index > 0 {
                writeln!(file).unwrap();
            }
            write!(file, "{}", line).unwrap();
        }
        if trailing_newline {
            writeln!(file).unwrap();
        }
        file
    }

    #[test]
    fn reads_recent_window_without_reversing_order() {
        let file = write_temp_jsonl(&["one", "two", "three", "four", "five"], true);

        let window = read_jsonl_line_window_from_end(file.path(), 0, 3).unwrap();

        assert_eq!(window.lines, vec!["three", "four", "five"]);
        assert_eq!(window.selected_line_count, 3);
        assert!(window.has_more_before);
    }

    #[test]
    fn reads_older_window_using_offset_from_end() {
        let file = write_temp_jsonl(&["one", "two", "three", "four", "five"], false);

        let window = read_jsonl_line_window_from_end(file.path(), 2, 2).unwrap();

        assert_eq!(window.lines, vec!["two", "three"]);
        assert_eq!(window.selected_line_count, 2);
        assert!(window.has_more_before);
    }

    #[test]
    fn reports_no_more_before_at_file_start() {
        let file = write_temp_jsonl(&["one", "two", "three"], true);

        let window = read_jsonl_line_window_from_end(file.path(), 2, 5).unwrap();

        assert_eq!(window.lines, vec!["one"]);
        assert_eq!(window.selected_line_count, 1);
        assert!(!window.has_more_before);
    }

    #[test]
    fn zero_limit_returns_empty_window() {
        let file = write_temp_jsonl(&["one", "two"], true);

        let window = read_jsonl_line_window_from_end(file.path(), 0, 0).unwrap();

        assert!(window.lines.is_empty());
        assert_eq!(window.selected_line_count, 0);
        assert!(!window.has_more_before);
    }
}
