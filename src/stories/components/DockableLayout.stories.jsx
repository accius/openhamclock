import { DockableLayout } from '@components/DockableLayout.jsx';

export default {
  title: 'Components/DockableLayout',
  component: DockableLayout
};

const Box = ({ label }) => (
  <div style={{ padding: 12, background: 'var(--bg-panel)', border: '1px solid var(--border-color)', borderRadius: 6 }}>
    {label}
  </div>
);

export const Default = () => (
  <div style={{ height: 600 }}>
    <DockableLayout
      renderHeader={() => <Box label="Header" />}
      renderLeftSidebar={() => <Box label="Left Sidebar" />}
      renderRightSidebar={() => <Box label="Right Sidebar" />}
      renderWorldMap={() => <Box label="Map" />}
      renderPanels={{}}
    />
  </div>
);
