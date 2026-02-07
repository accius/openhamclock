import * as Icons from '@components/Icons.jsx';

export default {
  title: 'Components/Icons'
};

export const All = () => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, padding: 12 }}>
    {Object.entries(Icons)
      .filter(([name]) => name.startsWith('Icon'))
      .map(([name, Icon]) => (
        <div key={name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <Icon size={22} />
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{name}</span>
        </div>
      ))}
  </div>
);
