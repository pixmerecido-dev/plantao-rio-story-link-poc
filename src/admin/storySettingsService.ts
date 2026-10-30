import {panelObservedLimit,clampScale,minimumScale} from "./stickerSizeLimit.js";
import type {ObservedSizeLimitStore} from "../gestureLab/sizeLimitStore.js";
import {
  defaultSettings,
  validateSettings,
  type StorySettings,
} from "./domain.js";
import type { SettingsRepository } from "./repositories.js";
/** Interface pronta para o motor futuro; nenhuma chamada Appium nesta fase. */
export class StorySettingsService {
  constructor(private readonly repository: SettingsRepository, private readonly limits?:ObservedSizeLimitStore) {}
  getSettings() {
    return this.repository.getSettings();
  }
  async save(value: unknown) {
    const settings = validateSettings(value);
    if(this.limits&&settings.story.sticker.enabled){
      const s=settings.story.sticker;
      const limit=panelObservedLimit(await this.limits.load(),s.text,s.style_index);
      if(limit){s.scale=clampScale(s.scale,limit);s.max_scale=Math.max(s.max_scale,minimumScale(limit));}
    }
    await this.repository.saveSettings(settings);
    return settings;
  }
  restoreDefaults() {
    return this.save(defaultSettings());
  }
  async getStickerText() {
    return (await this.getSettings()).story.sticker.text;
  }
  async getStickerStyleIndex() {
    return (await this.getSettings()).story.sticker.style_index;
  }
  async getMaxTextLength() {
    return (await this.getSettings()).story.sticker.max_text_length;
  }
  async getStickerPresets() {
    return (await this.getSettings()).story.sticker.presets;
  }
  async getStickerScale() {
    return (await this.getSettings()).story.sticker.scale;
  }
  async getStickerPosition() {
    const s = (await this.getSettings()).story.sticker;
    return { x_pct: s.x_pct, y_pct: s.y_pct };
  }
  async getPublishingSettings() {
    return (await this.getSettings()).publishing;
  }
}
