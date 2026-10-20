const { BGHSmartControlPlatform, PLATFORM_NAME } = require('./src/platform');

module.exports = (api) => {
  api.registerPlatform(PLATFORM_NAME, BGHSmartControlPlatform);
};
