/*!
 * nodeclub - app.js
 */

/**
 * Module dependencies.
 */

var config = require('./config');

if (!config.debug && config.oneapm_key) {
  require('oneapm');
}

require('colors');
var path = require('path');
var Loader = require('loader');//静态资源加载
var LoaderConnect = require('loader-connect');
var express = require('express');
var session = require('express-session');
var passport = require('passport');
require('./middlewares/mongoose_log'); // 打印 mongodb 查询日志
require('./models');
var GitHubStrategy = require('passport-github').Strategy;
var githubStrategyMiddleware = require('./middlewares/github_strategy');
var webRouter = require('./web_router');
var apiRouterV1 = require('./api_router_v1');
var auth = require('./middlewares/auth');
var errorPageMiddleware = require('./middlewares/error_page');
var proxyMiddleware = require('./middlewares/proxy');
var RedisStore = require('connect-redis')(session);
var _ = require('lodash');
var csurf = require('csurf');
var compress = require('compression');
var bodyParser = require('body-parser');
var busboy = require('connect-busboy');
var errorhandler = require('errorhandler');
var cors = require('cors');
var requestLog = require('./middlewares/request_log');
var renderMiddleware = require('./middlewares/render');
var logger = require('./common/logger');
var helmet = require('helmet');
var bytes = require('bytes')


// 静态文件目录
var staticDir = path.join(__dirname, 'public');
// assets
var assets = {};

if (config.mini_assets) {
  try {
    assets = require('./assets.json');
  } catch (e) {
    logger.error('You must execute `make build` before start app when mini_assets is true.');
    throw e;
  }
}

var urlinfo = require('url').parse(config.host);
config.hostname = urlinfo.hostname || config.host;

var app = express();

// configuration in all env
app.set('views', path.join(__dirname, 'views')); // 页面视图地址
app.set('view engine', 'html');
app.engine('html', require('ejs-mate'));// 设置视图模板引擎
app.locals._layoutFile = 'layout.html'; // 本地登出页面文件
app.enable('trust proxy');

// Request logger。请求时间
app.use(requestLog);

if (config.debug) {
  // 渲染时间
  app.use(renderMiddleware.render);
}

// 静态资源
if (config.debug) {
  app.use(LoaderConnect.less(__dirname)); // 测试环境用，编译 .less 文件 on the fly
}
app.use('/public', express.static(staticDir));
app.use('/agent', proxyMiddleware.proxy); // 验证代理合法性

// 通用的中间件
app.use(require('response-time')()); // 请求时间
app.use(helmet.frameguard('sameorigin')); // 安全防护中间件
app.use(bodyParser.json({limit: '1mb'}));
app.use(bodyParser.urlencoded({ extended: true, limit: '1mb' }));// req.body 解析 设置
app.use(require('method-override')()); // 方法重载
app.use(require('cookie-parser')(config.session_secret));// cookie 解析  secret 自定义钥匙
app.use(compress());  // 压缩中间键
app.use(session({ // session 设置
  secret: config.session_secret,
  store: new RedisStore({
    port: config.redis_port,
    host: config.redis_host,
    db: config.redis_db,
    pass: config.redis_password,
  }),
  resave: false,
  saveUninitialized: false,
}));

// oauth 中间件
app.use(passport.initialize()); //passport验证请求

passport.serializeUser(function (user, done) { // passport 的序列化
  done(null, user);
});
passport.deserializeUser(function (user, done) { // passport 的反序列化
  done(null, user);
});
passport.use(new GitHubStrategy(config.GITHUB_OAUTH, githubStrategyMiddleware));// github oauth git身份验证

// custom middleware
app.use(auth.authUser); // 验证用户是否登录
app.use(auth.blockUser()); // 验证用户是否被屏蔽

if (!config.debug) {
  app.use(function (req, res, next) {
    if (req.path === '/api' || req.path.indexOf('/api') === -1) { // 当正式环境下请求api是时 使用csurf
      csurf()(req, res, next);//防止CSRF攻击 (跨站请求伪造 Cross-site request forgery);
      return;
    }
    next();
  });
  app.set('view cache', true); //视图编译缓存
}

// for debug
// app.get('/err', function (req, res, next) {
//   next(new Error('haha'))
// });

// set static, dynamic helpers
_.extend(app.locals, { //扩展app.locals对象
  config: config,
  Loader: Loader,
  assets: assets
});

app.use(errorPageMiddleware.errorPage);
_.extend(app.locals, require('./common/render_helper'));
app.use(function (req, res, next) {
  res.locals.csrf = req.csrfToken ? req.csrfToken() : '';
  next();
});

app.use(busboy({
  limits: {
    fileSize: bytes(config.file_limit)
  }
}));

// routes
app.use('/api/v1', cors(), apiRouterV1); //api 跨区路由
app.use('/', webRouter); // 正常web路由

// error handler
if (config.debug) {
  app.use(errorhandler());
} else {
  app.use(function (err, req, res, next) {
    logger.error(err);
    return res.status(500).send('500 status');
  });
}

if (!module.parent) {
  app.listen(config.port, function () {
    logger.info('NodeClub listening on port', config.port);
    logger.info('God bless love....');
    logger.info('You can debug your app with http://' + config.hostname + ':' + config.port);
    logger.info('');
  });
}

module.exports = app;
