import baseConfig from './webpack.base'
import HtmlWebpackPlugin from 'html-webpack-plugin'
import MiniCssExtractPlugin from 'mini-css-extract-plugin'
//import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer'
import webpack from 'webpack'
import path from 'path'
import express from 'express'

const PORT = 3001

// 沙箱 iframe 通过 <script> 加载 React/ReactDOM/antd/moment 的 UMD 包作为
// webpack external 全局变量。直接引用 unpkg 会受网络 / ORB(CORB) 限制，
// 且 unpkg 上的 react latest 已升到 19，与项目使用的 react 17 不兼容。
// 这里通过 devServer 中间件把 node_modules 里本地安装的、版本匹配的 UMD
// 文件映射为同源 URL，保证沙箱能稳定加载并执行。
const UMD_ASSETS: Record<string, string> = {
  '/vendor/react.min.js': require.resolve('react/umd/react.production.min.js'),
  '/vendor/react-dom.min.js': require.resolve(
    'react-dom/umd/react-dom.production.min.js'
  ),
  '/vendor/moment.min.js': require.resolve(
    'moment/min/moment-with-locales.min.js'
  ),
  '/vendor/antd.min.js': require.resolve('antd/dist/antd-with-locales.min.js'),
}

const createPages = (pages) => {
  return pages.map(({ filename, template, chunk }) => {
    return new HtmlWebpackPlugin({
      filename,
      template,
      inject: 'body',
      chunks: chunk,
    })
  })
}

for (let key in baseConfig.entry) {
  if (Array.isArray(baseConfig.entry[key])) {
    baseConfig.entry[key].push(
      require.resolve('webpack/hot/dev-server'),
      `${require.resolve('webpack-dev-server/client')}?http://localhost:${PORT}`
    )
  }
}

export default {
  ...baseConfig,
  plugins: [
    new MiniCssExtractPlugin({
      filename: '[name].[hash].css',
      chunkFilename: '[id].[hash].css',
    }),
    ...createPages([
      {
        filename: 'index.html',
        template: path.resolve(__dirname, './template.ejs'),
        chunk: ['playground'],
      },
    ]),
    new webpack.HotModuleReplacementPlugin(),
    // new BundleAnalyzerPlugin()
  ],
  devServer: {
    host: '127.0.0.1',
    open: true,
    port: PORT,
    before: (app: express.Application) => {
      Object.keys(UMD_ASSETS).forEach((urlPath) => {
        app.get(urlPath, (_req, res) => {
          res.sendFile(UMD_ASSETS[urlPath])
        })
      })
    },
  },
}
