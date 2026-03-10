import { HexColorPicker, RgbaColorPicker } from 'react-colorful';
import { THEME_COLOR_CONFIG } from '../theme/themeConfig';
import { useTranslation } from 'react-i18next';
import { rgbaStringToObject, rgbaObjectToString } from '../theme/colorUtils';

export default function CustomThemeEditor({ id, customTheme, updateCustomVar, resetCustomToDefault }) {
  const { t } = useTranslation();

  return (
    <>
      <button
        className="reset-theme-button"
        onClick={() => {
          if (window.confirm(t('station.settings.theme.reset.confirm'))) {
            resetCustomToDefault();
          }
        }}
      >
        ⚠️ {t('station.settings.theme.reset')}
      </button>

      <div id={id}>
        {Object.entries(THEME_COLOR_CONFIG).map(([key, cfg]) => {
          const value = customTheme[key];

          return (
            <div key={key} className={'custom-theme-colorpicker'}>
              <label>{t('station.settings.theme.custom.' + key)}</label>

              {cfg.alpha ? (
                <RgbaColorPicker
                  color={rgbaStringToObject(value)}
                  onChange={(colorObj) => {
                    const rgbaString = rgbaObjectToString(colorObj);
                    updateCustomVar(key, rgbaString);
                  }}
                />
              ) : (
                <HexColorPicker
                  color={value}
                  onChange={(hex) => {
                    updateCustomVar(key, hex);
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
