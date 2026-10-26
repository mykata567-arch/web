const { createApi } = require('./services/cloud-api');
const config = require('./config/index');

App({
  onLaunch() { this.api = createApi(wx, config); }
});
