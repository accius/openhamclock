import { HexColorPicker, RgbaColorPicker } from 'react-colorful';
import { THEME_COLOR_CONFIG } from '../theme/themeConfig';
import { useTranslation } from 'react-i18next';

export default function CustomThemeEditor({ id, customTheme, updateCustomVar }) {
  const { t } = useTranslation();

  return (
    <div id={id}>
      {Object.entries(THEME_COLOR_CONFIG).map(([key, cfg]) => {
        const Picker = cfg.alpha ? RgbaColorPicker : HexColorPicker;

        return (
          <div key={key} className={`custom-theme-colorpicker ${cfg.hueRestrict !== null ? 'hue-locked' : ''}`}>
            <label>{t('station.settings.theme.custom.' + key)}</label>
            <Picker
              color={customTheme[key]}
              onChange={(color) => {
                updateCustomVar(key, color);
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
