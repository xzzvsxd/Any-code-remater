import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Save,
  X,
  Eye,
  EyeOff,
  Info,
  Loader2,
  Layers,
  Lock,
  AlertTriangle,
} from 'lucide-react';
import { type ProviderConfig } from '@/lib/api';
import { Toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { useTranslation } from "@/hooks/useTranslation";

interface ProviderFormV2Props {
  initialData?: ProviderConfig;
  onSubmit: (formData: Omit<ProviderConfig, 'id'>) => Promise<void>;
  onCancel: () => void;
}

/**
 * ProviderFormV2 —— 全新代理商表单
 *
 * 相比旧 ProviderForm，新增：
 * - "任务槽位模型"分区：haiku/sonnet/opus/fable 各自的自定义模型（写 ANTHROPIC_DEFAULT_*_MODEL）
 * - "强制锁定模型"输入：写 ANTHROPIC_MODEL，覆盖会话模型选择（含自动模式），带警告说明
 *
 * 复用现有 api（add/update/switch ProviderConfig），仅扩展字段。
 */
export default function ProviderFormV2({
  initialData,
  onSubmit,
  onCancel,
}: ProviderFormV2Props) {
  const { t } = useTranslation();
  const [formData, setFormData] = useState<Omit<ProviderConfig, 'id'>>({
    name: initialData?.name || '',
    description: initialData?.description || '',
    base_url: initialData?.base_url || '',
    auth_token: initialData?.auth_token || '',
    api_key: initialData?.api_key || '',
    api_key_helper: undefined,
    enable_auto_api_key_helper: initialData?.enable_auto_api_key_helper || false,
    haiku_model: initialData?.haiku_model || '',
    sonnet_model: initialData?.sonnet_model || '',
    opus_model: initialData?.opus_model || '',
    fable_model: initialData?.fable_model || '',
    // 兼容旧配置：旧的单一 model 字段视作锁定模型
    lock_model: initialData?.lock_model || initialData?.model || '',
  });

  const [loading, setLoading] = useState(false);
  const [showTokens, setShowTokens] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const isEditing = !!initialData;

  const handleInputChange = (field: keyof Omit<ProviderConfig, 'id'>, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value || undefined,
    }));
  };

  const validateForm = (): string | null => {
    if (!formData.name.trim()) {
      return t('provider.providerNameRequiredClaude');
    }
    if (!formData.base_url.trim()) {
      return t('provider.baseUrlRequired');
    }
    if (!formData.base_url.startsWith('http://') && !formData.base_url.startsWith('https://')) {
      return t('provider.baseUrlInvalid');
    }
    if (!formData.auth_token?.trim() && !formData.api_key?.trim()) {
      return t('provider.authRequired');
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const error = validateForm();
    if (error) {
      setToastMessage({ message: error, type: 'error' });
      return;
    }

    try {
      setLoading(true);

      const submitData: Omit<ProviderConfig, 'id'> = {
        name: formData.name.trim(),
        description: formData.description.trim(),
        base_url: formData.base_url.trim(),
        auth_token: formData.auth_token?.trim() || undefined,
        api_key: formData.api_key?.trim() || undefined,
        api_key_helper: undefined,
        enable_auto_api_key_helper: formData.enable_auto_api_key_helper,
        haiku_model: formData.haiku_model?.trim() || undefined,
        sonnet_model: formData.sonnet_model?.trim() || undefined,
        opus_model: formData.opus_model?.trim() || undefined,
        fable_model: formData.fable_model?.trim() || undefined,
        lock_model: formData.lock_model?.trim() || undefined,
        // 不再单独写旧 model 字段，统一用 lock_model
        model: undefined,
      };

      await onSubmit(submitData);
    } catch (error) {
      console.error('Failed to save provider config:', error);
      setToastMessage({
        message: t('provider.saveConfigFailed', { error: String(error) }),
        type: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      onCancel();
    }
  };

  const slotFields: Array<{ field: keyof Omit<ProviderConfig, 'id'>; labelKey: string }> = [
    { field: 'haiku_model', labelKey: 'provider.slotHaikuLabel' },
    { field: 'sonnet_model', labelKey: 'provider.slotSonnetLabel' },
    { field: 'opus_model', labelKey: 'provider.slotOpusLabel' },
    { field: 'fable_model', labelKey: 'provider.slotFableLabel' },
  ];

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card className="p-4 space-y-4">
        {/* 基本信息 */}
        <div className="space-y-4">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Info className="h-4 w-4" />
            {t('provider.basicInfo')}
          </h3>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">{t('provider.providerNameLabel')} *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
                placeholder={t('provider.providerNamePlaceholderClaude')}
                disabled={loading}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">{t('provider.descriptionLabel')}</Label>
              <Input
                id="description"
                value={formData.description}
                onChange={(e) => handleInputChange('description', e.target.value)}
                placeholder={t('provider.descriptionPlaceholderClaude')}
                disabled={loading}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="base_url">{t('provider.baseUrlLabel')} *</Label>
            <Input
              id="base_url"
              value={formData.base_url}
              onChange={(e) => handleInputChange('base_url', e.target.value)}
              placeholder="https://api.anthropic.com"
              disabled={loading}
              required
            />
          </div>
        </div>

        {/* 认证信息 */}
        <div className="space-y-4 pt-4 border-t">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Eye className="h-4 w-4" />
            {t('provider.authInfo')}
            <span className="text-xs text-muted-foreground ml-2">
              {t('provider.atLeastOne')}
            </span>
          </h3>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="auth_token">{t('provider.authTokenLabel')}</Label>
              <div className="relative">
                <Input
                  id="auth_token"
                  type={showTokens ? "text" : "password"}
                  value={formData.auth_token || ''}
                  onChange={(e) => handleInputChange('auth_token', e.target.value)}
                  placeholder="sk-ant-..."
                  disabled={loading}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1 h-8 w-8 p-0"
                  onClick={() => setShowTokens(!showTokens)}
                >
                  {showTokens ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="api_key">API Key</Label>
              <div className="relative">
                <Input
                  id="api_key"
                  type={showTokens ? "text" : "password"}
                  value={formData.api_key || ''}
                  onChange={(e) => handleInputChange('api_key', e.target.value)}
                  placeholder="sk-..."
                  disabled={loading}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1 h-8 w-8 p-0"
                  onClick={() => setShowTokens(!showTokens)}
                >
                  {showTokens ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                </Button>
              </div>
            </div>

            {/* API Key Helper 控制选项 */}
            <div className="p-3 bg-muted/50 rounded-lg space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="enable-auto-api-key-helper"
                  checked={formData.enable_auto_api_key_helper}
                  onCheckedChange={(checked) =>
                    setFormData(prev => ({ ...prev, enable_auto_api_key_helper: !!checked }))
                  }
                  disabled={loading}
                />
                <Label
                  htmlFor="enable-auto-api-key-helper"
                  className="text-sm font-medium cursor-pointer"
                >
                  {t('provider.enableAutoApiKeyHelper')}
                </Label>
              </div>
              <p className="text-xs text-muted-foreground">
                {formData.enable_auto_api_key_helper
                  ? t('provider.autoKeyHelperEnabled')
                  : t('provider.autoKeyHelperDisabled')}
              </p>
            </div>
          </div>
        </div>

        {/* 任务槽位模型 */}
        <div className="space-y-4 pt-4 border-t">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Layers className="h-4 w-4" />
            {t('provider.slotModelsTitle')}
          </h3>
          <p className="text-xs text-muted-foreground">{t('provider.slotModelsHint')}</p>

          <div className="grid grid-cols-2 gap-4">
            {slotFields.map(({ field, labelKey }) => (
              <div className="space-y-2" key={field}>
                <Label htmlFor={field}>{t(labelKey)}</Label>
                <Input
                  id={field}
                  value={(formData[field] as string) || ''}
                  onChange={(e) => handleInputChange(field, e.target.value)}
                  placeholder={t('provider.slotModelPlaceholder')}
                  disabled={loading}
                />
              </div>
            ))}
          </div>
        </div>

        {/* 强制锁定模型 */}
        <div className="space-y-3 pt-4 border-t">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Lock className="h-4 w-4" />
            {t('provider.lockModelTitle')}
          </h3>
          <div className="space-y-2">
            <Label htmlFor="lock_model">{t('provider.lockModelLabel')}</Label>
            <Input
              id="lock_model"
              value={formData.lock_model || ''}
              onChange={(e) => handleInputChange('lock_model', e.target.value)}
              placeholder={t('provider.lockModelPlaceholder')}
              disabled={loading}
            />
          </div>
          {formData.lock_model?.trim() && (
            <div className="flex items-start gap-2 p-2.5 rounded-md bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {t('provider.lockModelWarning')}
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* 操作按钮 */}
      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={handleClose} disabled={loading}>
          <X className="h-4 w-4 mr-2" aria-hidden="true" />
          {t('buttons.cancel')}
        </Button>
        <Button
          type="submit"
          disabled={loading}
          className={cn("transition-all duration-200", loading && "scale-95 opacity-80")}
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
              {isEditing ? t('provider.updating') : t('provider.adding')}
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" aria-hidden="true" />
              {isEditing ? t('provider.updateConfig') : t('provider.addConfig')}
            </>
          )}
        </Button>
      </div>

      {toastMessage && (
        <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center p-4 pointer-events-none">
          <div className="pointer-events-auto">
            <Toast
              message={toastMessage.message}
              type={toastMessage.type}
              onDismiss={() => setToastMessage(null)}
            />
          </div>
        </div>
      )}
    </form>
  );
}
