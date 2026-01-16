// eslint-disable-next-line import/no-extraneous-dependencies
import { importMapsPlugin } from '@web/dev-server-import-maps';

export default {
  coverageConfig: {
    exclude: [
      '**/mocks/**',
      '**/node_modules/**',
    ],
  },
  nodeResolve: true,
  plugins: [
    importMapsPlugin({
      inject: {
        importMap: {
          imports: {
            // Stub out hast-util-from-html - not needed in browser (DOMParser is used)
            'hast-util-from-html': '/test/fixtures/hast-stub.js',
          },
        },
      },
    }),
  ],
};
