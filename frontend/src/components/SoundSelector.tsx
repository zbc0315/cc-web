import { useState, useEffect, useRef } from 'react';
import { Music, Download, Upload, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  SoundConfig, SoundPreset, AvailableSound,
  getSoundPresets, downloadSoundPreset, getAvailableSounds, uploadSound,
} from '@/lib/api';

interface SoundSelectorProps {
  projectId: string;
  config: SoundConfig;
  onChange: (config: SoundConfig) => void;
}

export default function SoundSelector({ projectId, config, onChange }: SoundSelectorProps) {
  const [presets, setPresets] = useState<SoundPreset[]>([]);
  const [sounds, setSounds] = useState<AvailableSound[]>([]);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getSoundPresets().then(setPresets).catch(console.error);
    getAvailableSounds(projectId).then(setSounds).catch(console.error);
  }, [projectId]);

  const update = (partial: Partial<SoundConfig>) => {
    onChange({ ...config, ...partial });
  };

  const handleSourceChange = async (source: string) => {
    // Check if it's a preset that needs downloading
    if (source.startsWith('preset:')) {
      const presetId = source.replace('preset:', '');
      const preset = presets.find(p => p.id === presetId);
      if (preset && !preset.downloaded) {
        setDownloading(presetId);
        try {
          await downloadSoundPreset(presetId);
          setPresets(prev => prev.map(p => p.id === presetId ? { ...p, downloaded: true } : p));
          // Refresh available sounds after download
          const updated = await getAvailableSounds(projectId);
          setSounds(updated);
        } catch (err) {
          console.error('Failed to download preset:', err);
          setDownloading(null);
          return;
        }
        setDownloading(null);
      }
    }
    update({ source });
  };

  const handleUpload = async (scope: 'global' | 'project') => {
    const input = fileInputRef.current;
    if (!input) return;
    input.dataset.scope = scope;
    input.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const scope = (e.target.dataset.scope as 'global' | 'project') || 'global';
    setUploading(true);
    try {
      const { name } = await uploadSound(file, scope, projectId);
      const updated = await getAvailableSounds(projectId);
      setSounds(updated);
      const sourcePrefix = scope === 'project' ? 'project' : 'global';
      update({ source: `${sourcePrefix}:${name}` });
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  // Group available sounds by scope
  const presetSounds = sounds.filter(s => s.source.startsWith('preset:'));
  const globalSounds = sounds.filter(s => s.source.startsWith('global:'));
  const projectSounds = sounds.filter(s => s.source.startsWith('project:'));

  // Also include presets that aren't downloaded yet (from presets list)
  const undownloadedPresets = presets.filter(
    p => !p.downloaded && !presetSounds.some(s => s.source === `preset:${p.id}`)
  );

  const showIntervalRange = config.playMode === 'interval' ||
    (config.playMode === 'auto' && presets.find(p => `preset:${p.id}` === config.source)?.type === 'strike');

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <Music className={`h-4 w-4 ${config.enabled ? 'text-primary' : ''}`} />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px]">
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">背景音效</Label>
            <Switch
              checked={config.enabled}
              onCheckedChange={(enabled) => update({ enabled })}
            />
          </div>

          {/* Sound source */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">音源</Label>
            <Select value={config.source} onValueChange={handleSourceChange}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="选择音源" />
              </SelectTrigger>
              <SelectContent>
                {(presetSounds.length > 0 || undownloadedPresets.length > 0) && (
                  <SelectGroup>
                    <SelectLabel>预设音效</SelectLabel>
                    {presetSounds.map(s => (
                      <SelectItem key={s.source} value={s.source} className="text-xs">
                        {s.name}
                      </SelectItem>
                    ))}
                    {undownloadedPresets.map(p => (
                      <SelectItem key={`preset:${p.id}`} value={`preset:${p.id}`} className="text-xs">
                        <span className="flex items-center gap-1.5">
                          {p.name}
                          {downloading === p.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Download className="h-3 w-3 text-muted-foreground" />
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {globalSounds.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>全局自定义</SelectLabel>
                    {globalSounds.map(s => (
                      <SelectItem key={s.source} value={s.source} className="text-xs">
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {projectSounds.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>项目自定义</SelectLabel>
                    {projectSounds.map(s => (
                      <SelectItem key={s.source} value={s.source} className="text-xs">
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Play mode */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">播放模式</Label>
            <Select value={config.playMode} onValueChange={(v) => update({ playMode: v as SoundConfig['playMode'] })}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto" className="text-xs">自动</SelectItem>
                <SelectItem value="loop" className="text-xs">循环</SelectItem>
                <SelectItem value="interval" className="text-xs">随机间隔</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Volume */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              音量: {Math.round(config.volume * 100)}%
            </Label>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(config.volume * 100)}
              onChange={(e) => update({ volume: Number(e.target.value) / 100 })}
              className="w-full h-1.5 accent-primary cursor-pointer"
            />
          </div>

          {/* Interval range */}
          {showIntervalRange && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">间隔范围（秒）</Label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  value={config.intervalRange[0]}
                  onChange={(e) => update({ intervalRange: [Number(e.target.value), config.intervalRange[1]] })}
                  className="w-20 h-8 rounded-md border bg-background px-2 text-xs"
                />
                <span className="text-xs text-muted-foreground">~</span>
                <input
                  type="number"
                  min={1}
                  value={config.intervalRange[1]}
                  onChange={(e) => update({ intervalRange: [config.intervalRange[0], Number(e.target.value)] })}
                  className="w-20 h-8 rounded-md border bg-background px-2 text-xs"
                />
              </div>
            </div>
          )}

          {/* Upload */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-7 text-xs"
              disabled={uploading}
              onClick={() => handleUpload('global')}
            >
              {uploading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Upload className="h-3 w-3 mr-1" />}
              上传全局
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-7 text-xs"
              disabled={uploading}
              onClick={() => handleUpload('project')}
            >
              {uploading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Upload className="h-3 w-3 mr-1" />}
              上传项目
            </Button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={handleFileSelected}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
