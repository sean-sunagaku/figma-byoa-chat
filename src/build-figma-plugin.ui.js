module.exports = function (buildOptions) {
  const jsxRuntimePath = require.resolve('preact/jsx-runtime', {
    paths: [process.cwd()]
  })

  const aliasPlugin = {
    name: 'react-jsx-runtime-alias',
    setup(build) {
      build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({
        path: jsxRuntimePath
      }))
      build.onResolve({ filter: /^react\/jsx-dev-runtime$/ }, () => ({
        path: jsxRuntimePath
      }))
    }
  }

  return {
    ...buildOptions,
    plugins: [...buildOptions.plugins, aliasPlugin]
  }
}
