import { useState, useEffect, useCallback } from 'react';
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Settings2,
  Globe,
  Check,
  AlertCircle,
  RefreshCw,
  Trash2,
  TestTube,
  Eye,
  EyeOff,
  Plus,
  Edit,
  Trash,
  DollarSign,
  Infinity,
  Calendar,
  Lock,
  Layers,
} from 'lucide-react';
import { api, type ProviderConfig, type CurrentProviderConfig, type ApiKeyUsage } from '@/lib/api';
import { Toast } from '@/components/ui/toast';
import ProviderFormV2 from './ProviderFormV2';
import { useTranslation } from "@/hooks/useTranslation";
import { SortableList } from '@/components/ui/sortable-list';

interface ProviderManagerV2Props {
  onBack: () => void;
}

/**
 * ProviderManagerV2 —— 全新多代理商面板
 *
 * 在原有多预设 / 一键切换 / 拖拽排序 / 测连接 / 查余额基础上，
 * 展示并管理每个 Provider 的四个任务槽位模型（haiku/sonnet/opus/fable）与强制锁定模型。
 * 复用现有后端命令（getProviderPresets / switchProviderConfig / CRUD / reorder / test / usage）。
 */
export default function ProviderManagerV2({ onBack }: ProviderManagerV2Props) {
  const { t } = useTranslation();
  const [presets, setPresets] = useState<ProviderConfig[]>([]);
  const [currentConfig, setCurrentConfig] = useState<CurrentProviderConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showCurrentConfig, setShowCurrentConfig] = useState(false);
  const [showTokens, setShowTokens] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ProviderConfig | null>(null);
  const [toastMessage, setToastMessage] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [providerToDelete, setProviderToDelete] = useState<ProviderConfig | null>(null);

  const [queryingUsage, setQueryingUsage] = useState<string | null>(null);
  const [usageDialogOpen, setUsageDialogOpen] = useState(false);
  const [usageData, setUsageData] = useState<ApiKeyUsage | null>(null);
  const [usageProvider, setUsageProvider] = useState<ProviderConfig | null>(null);
  const [usageCache, setUsageCache] = useState<Record<string, ApiKeyUsage>>({});

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [presetsData, configData] = await Promise.all([
        api.getProviderPresets(),
        api.getCurrentProviderConfig(),
      ]);
      setPresets(presetsData);
      setCurrentConfig(configData);
    } catch (error) {
      console.error('Failed to load provider data:', error);
      setToastMessage({ message: t('provider.loadConfigFailed'), type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const switchProvider = async (config: ProviderConfig) => {
    try {
      setSwitching(config.id);
      const message = await api.switchProviderConfig(config);
      setToastMessage({ message, type: 'success' });
      await loadData();
    } catch (error) {
      console.error('Failed to switch provider:', error);
      setToastMessage({ message: t('provider.switchFailed'), type: 'error' });
    } finally {
      setSwitching(null);
    }
  };

  const clearProvider = async () => {
    try {
      setSwitching('clear');
      const message = await api.clearProviderConfig();
      setToastMessage({ message, type: 'success' });
      await loadData();
    } catch (error) {
      console.error('Failed to clear provider:', error);
      setToastMessage({ message: t('provider.clearConfigFailed'), type: 'error' });
    } finally {
      setSwitching(null);
    }
  };

  const testConnection = async (config: ProviderConfig) => {
    try {
      setTesting(config.id);
      const message = await api.testProviderConnection(config.base_url);
      setToastMessage({ message, type: 'success' });
    } catch (error) {
      console.error('Failed to test connection:', error);
      setToastMessage({ message: t('provider.connectionTestFailed'), type: 'error' });
    } finally {
      setTesting(null);
    }
  };

  const queryUsage = async (config: ProviderConfig, showDialog: boolean = true) => {
    const apiKey = config.api_key || config.auth_token;
    if (!apiKey) {
      setToastMessage({ message: t('provider.noApiKeyForUsage'), type: 'error' });
      return;
    }
    try {
      setQueryingUsage(config.id);
      const usage = await api.queryProviderUsage(config.base_url, apiKey);
      setUsageCache(prev => ({ ...prev, [config.id]: usage }));
      if (showDialog) {
        setUsageData(usage);
        setUsageProvider(config);
        setUsageDialogOpen(true);
      }
    } catch (error) {
      console.error('Failed to query usage:', error);
      setToastMessage({ message: t('provider.queryUsageFailed', { error: String(error) }), type: 'error' });
    } finally {
      setQueryingUsage(null);
    }
  };

  const formatCurrency = (value: number): string => `$${value.toFixed(2)}`;
  const formatDate = (timestamp: number): string => {
    if (timestamp === 0) return t('provider.neverExpires');
    return new Date(timestamp * 1000).toLocaleString('zh-CN');
  };

  const handleAddProvider = () => {
    setEditingProvider(null);
    setShowForm(true);
  };

  const handleEditProvider = (config: ProviderConfig) => {
    setEditingProvider(config);
    setShowForm(true);
  };

  const handleDeleteProvider = (config: ProviderConfig) => {
    setProviderToDelete(config);
    setDeleteDialogOpen(true);
  };

  const confirmDeleteProvider = async () => {
    if (!providerToDelete) return;
    try {
      setDeleting(providerToDelete.id);
      await api.deleteProviderConfig(providerToDelete.id);
      setToastMessage({ message: t('provider.deleteSuccess'), type: 'success' });
      await loadData();
      setDeleteDialogOpen(false);
      setProviderToDelete(null);
    } catch (error) {
      console.error('Failed to delete provider:', error);
      setToastMessage({ message: t('provider.deleteFailed'), type: 'error' });
    } finally {
      setDeleting(null);
    }
  };

  const cancelDeleteProvider = () => {
    setDeleteDialogOpen(false);
    setProviderToDelete(null);
  };

  const handleFormSubmit = async (formData: Omit<ProviderConfig, 'id'>) => {
    try {
      if (editingProvider) {
        const updatedConfig = { ...formData, id: editingProvider.id };
        await api.updateProviderConfig(updatedConfig);
        if (isCurrentProvider(editingProvider)) {
          try {
            await api.switchProviderConfig(updatedConfig);
            setToastMessage({ message: t('provider.updateSyncSuccess'), type: 'success' });
          } catch (switchError) {
            console.error('Failed to sync provider config:', switchError);
            setToastMessage({ message: t('provider.updateSyncFailed'), type: 'error' });
          }
        } else {
          setToastMessage({ message: t('provider.updateSuccess'), type: 'success' });
        }
      } else {
        await api.addProviderConfig(formData);
        setToastMessage({ message: t('provider.addSuccess'), type: 'success' });
      }
      setShowForm(false);
      setEditingProvider(null);
      await loadData();
    } catch (error) {
      console.error('Failed to save provider:', error);
      setToastMessage({ message: editingProvider ? t('provider.updateFailed') : t('provider.addFailed'), type: 'error' });
    }
  };

  const handleFormCancel = () => {
    setShowForm(false);
    setEditingProvider(null);
  };

  const isCurrentProvider = (config: ProviderConfig): boolean => {
    if (!currentConfig) return false;
    if (currentConfig.anthropic_base_url !== config.base_url) return false;
    const currentApiKey = currentConfig.anthropic_api_key;
    const currentAuthToken = currentConfig.anthropic_auth_token;
    if (config.api_key && currentApiKey !== config.api_key) return false;
    if (config.auth_token && currentAuthToken !== config.auth_token) return false;
    return true;
  };

  const maskToken = (token: string): string => {
    if (!token || token.length <= 10) return token;
    const start = token.substring(0, 8);
    const end = token.substring(token.length - 4);
    return `${start}${'*'.repeat(token.length - 12)}${end}`;
  };

  // 汇总一个 provider 已配置的四槽位（用于卡片展示）
  const getSlots = (config: ProviderConfig): Array<{ label: string; value: string }> => {
    const slots: Array<{ label: string; value: string }> = [];
    if (config.haiku_model) slots.push({ label: 'Haiku', value: config.haiku_model });
    if (config.sonnet_model) slots.push({ label: 'Sonnet', value: config.sonnet_model });
    if (config.opus_model) slots.push({ label: 'Opus', value: config.opus_model });
    if (config.fable_model) slots.push({ label: 'Fable', value: config.fable_model });
    return slots;
  };

  const getLockModel = (config: ProviderConfig): string | undefined =>
    config.lock_model || config.model || undefined;

  const handleReorder = useCallback(async (reorderedPresets: ProviderConfig[]) => {
    setPresets(reorderedPresets);
    try {
      const ids = reorderedPresets.map(p => p.id);
      await api.reorderProviderConfigs(ids);
    } catch (error) {
      console.error('Failed to reorder providers:', error);
      setToastMessage({ message: t('provider.reorderFailed'), type: 'error' });
      loadData();
    }
  }, [t]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">{t('provider.loadingConfig')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8" aria-label={t('provider.backToSettings')}>
            <Settings2 className="h-4 w-4" aria-hidden="true" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold">{t('provider.providerManager')}</h1>
            <p className="text-xs text-muted-foreground">{t('provider.switchProvider')}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="default" size="sm" onClick={handleAddProvider} className="text-xs">
            <Plus className="h-3 w-3 mr-1" aria-hidden="true" />
            {t('provider.addProvider')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowCurrentConfig(true)} className="text-xs">
            <Eye className="h-3 w-3 mr-1" aria-hidden="true" />
            {t('provider.viewCurrentConfig')}
          </Button>
          <Button variant="destructive" size="sm" onClick={clearProvider} disabled={switching === 'clear'} className="text-xs">
            {switching === 'clear' ? (
              <RefreshCw className="h-3 w-3 mr-1 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="h-3 w-3 mr-1" aria-hidden="true" />
            )}
            {t('provider.clearConfig')}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          {presets.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <Globe className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-sm text-muted-foreground mb-4">{t('provider.noProvidersConfigured')}</p>
                <Button onClick={handleAddProvider} size="sm">
                  <Plus className="h-4 w-4 mr-2" />
                  {t('provider.addFirstProvider')}
                </Button>
              </div>
            </div>
          ) : (
            <SortableList
              items={presets}
              onReorder={handleReorder}
              renderItem={(config) => {
                const slots = getSlots(config);
                const lockModel = getLockModel(config);
                return (
                  <Card className={`p-4 ${isCurrentProvider(config) ? 'ring-2 ring-primary' : ''}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0 overflow-hidden">
                        <div className="flex items-center gap-3 mb-2">
                          <div className="flex items-center gap-2">
                            <Globe className="h-4 w-4 text-muted-foreground" />
                            <h3 className="font-medium">{config.name}</h3>
                          </div>
                          {isCurrentProvider(config) && (
                            <Badge variant="secondary" className="text-xs">
                              <Check className="h-3 w-3 mr-1" />
                              {t('provider.currentUsing')}
                            </Badge>
                          )}
                        </div>

                        <div className="space-y-1 text-sm text-muted-foreground">
                          <p className="truncate"><span className="font-medium">{t('provider.description')}</span>{config.description}</p>
                          <p className="truncate"><span className="font-medium">{t('provider.apiUrl')}</span>{config.base_url}</p>
                          {config.auth_token && (
                            <p className="truncate"><span className="font-medium">{t('provider.authToken')}</span>
                              {showTokens ? config.auth_token : maskToken(config.auth_token)}
                            </p>
                          )}
                          {config.api_key && (
                            <p className="truncate"><span className="font-medium">{t('provider.apiKey')}</span>
                              {showTokens ? config.api_key : maskToken(config.api_key)}
                            </p>
                          )}
                        </div>

                        {/* 任务槽位模型徽标 */}
                        {slots.length > 0 && (
                          <div className="flex items-center gap-1.5 flex-wrap mt-2">
                            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                            {slots.map((slot) => (
                              <Badge key={slot.label} variant="outline" className="text-[11px] font-normal">
                                <span className="font-medium mr-1">{slot.label}:</span>
                                <span className="text-muted-foreground truncate max-w-[160px]">{slot.value}</span>
                              </Badge>
                            ))}
                          </div>
                        )}

                        {/* 锁定模型徽标 */}
                        {lockModel && (
                          <div className="flex items-center gap-1.5 mt-2">
                            <Lock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                            <Badge variant="outline" className="text-[11px] font-normal border-amber-300 dark:border-amber-700">
                              <span className="font-medium mr-1">{t('provider.lockModelTitle')}:</span>
                              <span className="text-muted-foreground truncate max-w-[200px]">{lockModel}</span>
                            </Badge>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-3 flex-shrink-0">
                        {usageCache[config.id] && (
                          <div className="text-right text-xs space-y-0.5 border-r pr-3 mr-1">
                            <div className="text-muted-foreground">
                              {t('provider.used')} <span className="font-medium text-foreground">{formatCurrency(usageCache[config.id].used_balance)}</span>
                            </div>
                            <div className="text-muted-foreground">
                              {usageCache[config.id].is_unlimited ? (
                                <span className="text-green-600 font-medium flex items-center justify-end gap-1">
                                  {t('provider.remaining')} <Infinity className="h-3 w-3" /> {t('provider.unlimited')}
                                </span>
                              ) : (
                                <>
                                  {t('provider.remaining')} <span className={`font-medium ${usageCache[config.id].remaining_balance > 10 ? 'text-green-600' : 'text-red-600'}`}>
                                    {formatCurrency(usageCache[config.id].remaining_balance)}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        )}

                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="sm" onClick={() => queryUsage(config)} disabled={queryingUsage === config.id} className="text-xs" aria-label={t('provider.usageQuery')} title={t('provider.usageQuery')}>
                            {queryingUsage === config.id ? <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" /> : <DollarSign className="h-3 w-3" aria-hidden="true" />}
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => testConnection(config)} disabled={testing === config.id} className="text-xs" aria-label={t('tooltips.testConnection')}>
                            {testing === config.id ? <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" /> : <TestTube className="h-3 w-3" aria-hidden="true" />}
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => handleEditProvider(config)} className="text-xs" aria-label={t('provider.editProvider')}>
                            <Edit className="h-3 w-3" aria-hidden="true" />
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => handleDeleteProvider(config)} disabled={deleting === config.id} className="text-xs text-red-600 hover:text-red-700" aria-label={t('dialogs.confirmDelete')}>
                            {deleting === config.id ? <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Trash className="h-3 w-3" aria-hidden="true" />}
                          </Button>
                          <Button size="sm" onClick={() => switchProvider(config)} disabled={switching === config.id || isCurrentProvider(config)} className="text-xs">
                            {switching === config.id ? <RefreshCw className="h-3 w-3 mr-1 animate-spin" aria-hidden="true" /> : <Check className="h-3 w-3 mr-1" aria-hidden="true" />}
                            {isCurrentProvider(config) ? t('provider.alreadySelected') : t('provider.switchToConfig')}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              }}
            />
          )}

          {presets.length > 0 && (
            <div className="flex justify-center">
              <Button variant="ghost" size="sm" onClick={() => setShowTokens(!showTokens)} className="text-xs">
                {showTokens ? <EyeOff className="h-3 w-3 mr-1" aria-hidden="true" /> : <Eye className="h-3 w-3 mr-1" aria-hidden="true" />}
                {showTokens ? t('provider.hideToken') : t('provider.showToken')}Token
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Current Config Dialog */}
      <Dialog open={showCurrentConfig} onOpenChange={setShowCurrentConfig}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('provider.currentEnvConfig')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {currentConfig ? (
              <div className="space-y-3">
                {currentConfig.anthropic_base_url && (
                  <div>
                    <p className="font-medium text-sm">ANTHROPIC_BASE_URL</p>
                    <p className="text-sm text-muted-foreground font-mono bg-muted p-2 rounded">{currentConfig.anthropic_base_url}</p>
                  </div>
                )}
                {currentConfig.anthropic_auth_token && (
                  <div>
                    <p className="font-medium text-sm">ANTHROPIC_AUTH_TOKEN</p>
                    <p className="text-sm text-muted-foreground font-mono bg-muted p-2 rounded">{showTokens ? currentConfig.anthropic_auth_token : maskToken(currentConfig.anthropic_auth_token)}</p>
                  </div>
                )}
                {currentConfig.anthropic_api_key && (
                  <div>
                    <p className="font-medium text-sm">ANTHROPIC_API_KEY</p>
                    <p className="text-sm text-muted-foreground font-mono bg-muted p-2 rounded">{showTokens ? currentConfig.anthropic_api_key : maskToken(currentConfig.anthropic_api_key)}</p>
                  </div>
                )}
                {currentConfig.anthropic_model && (
                  <div>
                    <p className="font-medium text-sm">ANTHROPIC_MODEL</p>
                    <p className="text-sm text-muted-foreground font-mono bg-muted p-2 rounded">{currentConfig.anthropic_model}</p>
                  </div>
                )}
                {currentConfig.anthropic_default_haiku_model && (
                  <div>
                    <p className="font-medium text-sm">ANTHROPIC_DEFAULT_HAIKU_MODEL</p>
                    <p className="text-sm text-muted-foreground font-mono bg-muted p-2 rounded">{currentConfig.anthropic_default_haiku_model}</p>
                  </div>
                )}
                {currentConfig.anthropic_default_sonnet_model && (
                  <div>
                    <p className="font-medium text-sm">ANTHROPIC_DEFAULT_SONNET_MODEL</p>
                    <p className="text-sm text-muted-foreground font-mono bg-muted p-2 rounded">{currentConfig.anthropic_default_sonnet_model}</p>
                  </div>
                )}
                {currentConfig.anthropic_default_opus_model && (
                  <div>
                    <p className="font-medium text-sm">ANTHROPIC_DEFAULT_OPUS_MODEL</p>
                    <p className="text-sm text-muted-foreground font-mono bg-muted p-2 rounded">{currentConfig.anthropic_default_opus_model}</p>
                  </div>
                )}
                {currentConfig.anthropic_default_fable_model && (
                  <div>
                    <p className="font-medium text-sm">ANTHROPIC_DEFAULT_FABLE_MODEL</p>
                    <p className="text-sm text-muted-foreground font-mono bg-muted p-2 rounded">{currentConfig.anthropic_default_fable_model}</p>
                  </div>
                )}
                {currentConfig.anthropic_api_key_helper && (
                  <div>
                    <p className="font-medium text-sm">apiKeyHelper</p>
                    <p className="text-sm text-muted-foreground font-mono bg-muted p-2 rounded">{currentConfig.anthropic_api_key_helper}</p>
                    <p className="text-xs text-muted-foreground mt-1">{t('provider.tokenHelper')}</p>
                  </div>
                )}
                <div className="flex justify-center pt-2">
                  <Button variant="ghost" size="sm" onClick={() => setShowTokens(!showTokens)} className="text-xs">
                    {showTokens ? <EyeOff className="h-3 w-3 mr-1" aria-hidden="true" /> : <Eye className="h-3 w-3 mr-1" aria-hidden="true" />}
                    {showTokens ? t('provider.hideToken') : t('provider.showToken')}Token
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center py-8">
                <div className="text-center">
                  <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">{t('provider.noEnvVars')}</p>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Provider Form Dialog */}
      <Dialog open={showForm} onOpenChange={handleFormCancel}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingProvider ? t('provider.editProvider') : t('provider.addProvider')}</DialogTitle>
          </DialogHeader>
          <ProviderFormV2
            initialData={editingProvider || undefined}
            onSubmit={handleFormSubmit}
            onCancel={handleFormCancel}
          />
        </DialogContent>
      </Dialog>

      {/* Usage Query Result Dialog */}
      <Dialog open={usageDialogOpen} onOpenChange={setUsageDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              {t('provider.usageQuery')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {usageProvider && (
              <div className="text-sm text-muted-foreground mb-4">
                {t('provider.providerLabel')} <span className="font-medium text-foreground">{usageProvider.name}</span>
              </div>
            )}
            {usageData && (
              <div className="space-y-3">
                <div className="flex justify-between items-center p-3 bg-muted rounded-lg">
                  <span className="text-sm text-muted-foreground">{t('provider.totalBalance')}</span>
                  <span className={`font-semibold ${usageData.is_unlimited ? 'text-green-600' : ''}`}>
                    {usageData.is_unlimited ? (
                      <span className="flex items-center gap-1"><Infinity className="h-4 w-4" />{t('provider.unlimited')}</span>
                    ) : formatCurrency(usageData.total_balance)}
                  </span>
                </div>
                <div className="flex justify-between items-center p-3 bg-muted rounded-lg">
                  <span className="text-sm text-muted-foreground">{t('provider.usedBalance')}</span>
                  <span className="font-semibold">{formatCurrency(usageData.used_balance)}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-muted rounded-lg">
                  <span className="text-sm text-muted-foreground">{t('provider.remainingBalance')}</span>
                  <span className={`font-semibold ${usageData.is_unlimited ? 'text-green-600' : usageData.remaining_balance > 10 ? 'text-green-600' : 'text-red-600'}`}>
                    {usageData.is_unlimited ? (
                      <span className="flex items-center gap-1"><Infinity className="h-4 w-4" />{t('provider.noLimit')}</span>
                    ) : formatCurrency(usageData.remaining_balance)}
                  </span>
                </div>
                <div className="flex justify-between items-center p-3 bg-muted rounded-lg">
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    <Calendar className="h-3 w-3" />{t('provider.validUntil')}
                  </span>
                  <span className="font-semibold">{formatDate(usageData.access_until)}</span>
                </div>
                <div className="text-xs text-muted-foreground text-center pt-2 border-t">
                  {t('provider.queryPeriod', { start: usageData.query_start_date, end: usageData.query_end_date })}
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-end">
            <Button variant="outline" onClick={() => setUsageDialogOpen(false)}>{t('buttons.close')}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('provider.confirmDeleteProvider')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p>{t('provider.confirmDeleteMessage', { name: providerToDelete?.name })}</p>
            {providerToDelete && (
              <div className="p-3 bg-muted rounded-md">
                <p className="text-sm"><span className="font-medium">{t('provider.name')}</span>{providerToDelete.name}</p>
                <p className="text-sm"><span className="font-medium">{t('provider.description')}</span>{providerToDelete.description}</p>
                <p className="text-sm"><span className="font-medium">{t('provider.apiUrl')}</span>{providerToDelete.base_url}</p>
              </div>
            )}
            <p className="text-sm text-muted-foreground">{t('provider.deleteCannotUndo')}</p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={cancelDeleteProvider} disabled={deleting === providerToDelete?.id}>{t('buttons.cancel')}</Button>
            <Button variant="destructive" onClick={confirmDeleteProvider} disabled={deleting === providerToDelete?.id}>
              {deleting === providerToDelete?.id ? t('provider.deleting') : t('buttons.confirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {toastMessage && (
        <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center p-4 pointer-events-none">
          <div className="pointer-events-auto">
            <Toast message={toastMessage.message} type={toastMessage.type} onDismiss={() => setToastMessage(null)} />
          </div>
        </div>
      )}
    </div>
  );
}
