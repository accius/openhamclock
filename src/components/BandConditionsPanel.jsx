/**
 * BandConditionsPanel Component
 * Displays HF band conditions (GOOD/FAIR/POOR)
 */
import { useTranslation } from 'react-i18next';

export const BandConditionsPanel = ({ data, loading }) => {
  const { t } = useTranslation();
  const getConditionStyle = (condition) => {
    switch (condition) {
      case 'GOOD':
        return { color: 'var(--accent-green)', bg: 'rgba(0, 255, 136, 0.15)' };
      case 'FAIR':
        return { color: 'var(--accent-amber)', bg: 'rgba(255, 180, 50, 0.15)' };
      case 'POOR':
        return { color: 'var(--accent-red)', bg: 'rgba(255, 68, 102, 0.15)' };
      default:
        return { color: 'var(--text-muted)', bg: 'transparent' };
    }
  };

  return (
    <div className="panel" style={{ padding: '12px' }}>
      <div className="panel-header">{t('band.conditions')}</div>
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '20px' }}>
          <div className="loading-spinner" />
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(50px, 1fr))',
            gap: '6px',
          }}
        >
          {data.map(({ band, condition }) => {
            const style = getConditionStyle(condition);
            return (
              <div
                key={band}
                style={{
                  textAlign: 'center',
                  padding: '6px 4px',
                  background: style.bg,
                  borderRadius: '4px',
                  border: `1px solid ${style.color}33`,
                }}
              >
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: '700',
                    color: 'var(--text-primary)',
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                >
                  {band}
                </div>
                <div
                  style={{
                    fontSize: '9px',
                    fontWeight: '600',
                    color: style.color,
                    marginTop: '2px',
                  }}
                >
                  {t(`band.conditions.${condition.toLowerCase()}`)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default BandConditionsPanel;
