import { mergeConfig } from 'vite';
import path from 'path';

export default {
  framework: {
    name: '@storybook/react-vite',
    options: {}
  },
  stories: ['../src/**/*.stories.@(js|jsx|ts|tsx)'],
  addons: ['@storybook/addon-essentials'],
  docs: { autodocs: 'tag' },
  viteFinal: async (config) => {
    return mergeConfig(config, {
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '../src'),
          '@components': path.resolve(__dirname, '../src/components'),
          '@hooks': path.resolve(__dirname, '../src/hooks'),
          '@utils': path.resolve(__dirname, '../src/utils'),
          '@styles': path.resolve(__dirname, '../src/styles')
        }
      }
    });
  }
};
