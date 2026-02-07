import { PluginLayer } from '@components/PluginLayer.jsx';

export default {
  title: 'Components/PluginLayer',
  component: PluginLayer
};

const mockPlugin = {
  hook: () => null
};

export const Default = () => (
  <PluginLayer
    plugin={mockPlugin}
    enabled={true}
    opacity={0.8}
    map={null}
    callsign="N0CALL"
    locator="FN31"
    lowMemoryMode={false}
  />
);
