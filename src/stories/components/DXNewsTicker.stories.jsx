import { DXNewsTicker } from '@components/DXNewsTicker.jsx';

export default {
  title: 'Components/DXNewsTicker',
  component: DXNewsTicker
};

export const Default = () => (
  <div style={{ width: '100%', maxWidth: 600, border: '1px solid var(--border-color)' }}>
    <DXNewsTicker />
  </div>
);
