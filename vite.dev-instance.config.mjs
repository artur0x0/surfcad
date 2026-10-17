import { mergeConfig } from 'vite'
import baseConfig from './vite.config.js'
import { surfcadBuildDefine } from './scripts/vite-surfcad-build-define.mjs'

/** Dev-instance Vite config — same build metadata injection as the main app. */
export default mergeConfig(baseConfig, {
  define: surfcadBuildDefine(),
})
