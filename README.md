# ts-module-alias - CBSI-CMG Fork

This package is a major refactor of [ilearnio/module-alias](https://github.com/ilearnio/module-alias) using TypeScript.  This package changes some behaviors of the original.  Namely:

1. More recently added paths take priority over existing paths during module resolution.
2. Only the resolution paths of the immediate parent module are modified.


----

Create aliases of directories and register custom module paths in Node.

It also allows you to register aliases and directories that will act just like `node_modules` but with your own private modules, so that you can access them directly:

## Install

```
npm i --save https://github.com/cbsi-cmg/ts-module-alias.git#main
```

**Note:** This is not a publicly hosted fork of the package. So we will need to install using the GH clone link.

## Usage

Add your custom configuration to your `package.json` (in your application's root)

```json
// Aliases
"_moduleAliases": {
  "@root"      : ".",
  "@deep"      : "src/some/very/deep/directory/or/file",
  "@my_module" : "lib/some-file.js",
  "something"  : "src/foo",
}

// Custom module directories, just like `node_modules` but with your private modules (optional)
"_moduleDirectories": ["node_modules_custom"],
```

Initialize the new resolution rules within a module by creating an instance and passing the current module:

```ts
import ModuleAlias from '@cbsi-cmg/ts-module-alias';
new ModuleAlias();
```

## Advanced usage

If you don't want to modify your `package.json` or you just prefer to set it all up programmatically, then the following methods are available for you:

* `addAlias('alias', 'target_path')` - register a single alias
* `addAliases({ 'alias': 'target_path', ... }) ` - register multiple aliases
* `addPath(path)` - Register custom modules directory (like node_modules, but with your own modules)

_Examples:_
```ts
import ModuleAlias from '@cbsi-cmg/ts-module-alias';
const moduleAlias = new ModuleAlias(module);

//
// Register alias
//
moduleAlias.addAlias('@client', '/src/client');

// Or multiple aliases
moduleAlias.addAliases({
  '@root'  : '.',
  '@client': '/src/client',
  ...
});

// Custom handler function (starting from v2.1)
moduleAlias.addAlias('@src', (fromPath, request, alias) => {
  // fromPath - Full path of the file from which `require` was called
  // request - The path (first argument) that was passed into `require`
  // alias - The same alias that was passed as first argument to `addAlias` (`@src` in this case)

  // Return any custom target path for the `@src` alias depending on arguments
  if (fromPath.startsWith('/others')) {
    return '/others';
  }
  return '/src';
});

//
// Register custom modules directory
//
moduleAlias.addPath('/node_modules_custom');
moduleAlias.addPath('/src');
```

## Usage with WebPack

Luckily, WebPack has a built in support for aliases and custom modules directories so it's easy to make it work on the client side as well!

```js
// webpack.config.js
const npm_package = require('./package.json');

module.exports = {
  entry: { ... },
  resolve: {
    root: __dirname,
    alias: npm_package._moduleAliases || {},
    modules: npm_package._moduleDirectories || [] // eg: ["node_modules", "node_modules_custom", "src"]
  }
};
```

More details on the [official documentation](https://webpack.js.org/configuration/resolve).

## Usage with Jest

Unfortunately, `module-alias` itself would not work from Jest due to a custom behavior of Jest's `require`. But you can use it's own aliasing mechanism instead. The configuration can be defined either in `package.json` or `jest.config.js`. The example below is for `package.json`:

```json
"jest": {
  "moduleNameMapper": {
    "@root/(.*)": "<rootDir>/$1",
    "@client/(.*)": "<rootDir>/src/client/$1"
  },
}
```

More details on the [official documentation](https://jestjs.io/docs/en/configuration#modulenamemapper-objectstring-string--arraystring).

## Using within another NPM package

You can use `module-alias` within another NPM package, however there are a few things to take into consideration.

1. As the aliases are global, you should make sure your aliases are unique, to avoid conflicts with end-user code, or with other libraries using module-alias. For example, you could prefix your aliases with '@my-lib/', and then use require('@my-lib/deep').

## Known incompatibilities

This module does not play well with:

- Front-end JavaScript code. Module-alias is designed for server side so do not expect it to work with front-end frameworks (React, Vue, ...) as they tend to use Webpack. Use Webpack's [resolve.alias](https://webpack.js.org/configuration/resolve/#resolvealias) mechanism instead.
- [Jest](https://jestjs.io), which discards node's module system entirely to use it's own module system, bypassing module-alias.
- The [NCC compiler](https://github.com/zeit/ncc), as it uses WebPack under the hood without exposing properties, such as resolve.alias. It is not [something they wish to do](https://github.com/zeit/ncc/pull/460).

## How it works?

In order to register an alias it modifies the internal `Module._resolveFilename` method so that when you use `require` or `import` it first checks whether the given string starts with one of the registered aliases, if so, it replaces the alias in the string with the target path of the alias.

In order to register a custom modules path (`addPath`) it modifies the internal `Module._nodeModulePaths` method so that the given directory then acts like it's the `node_modules` directory.

[npm-image]: https://img.shields.io/npm/v/module-alias.svg
[npm-url]: https://npmjs.org/package/module-alias
[travis-image]: https://img.shields.io/travis/ilearnio/module-alias/master.svg
[travis-url]: https://travis-ci.org/ilearnio/module-alias
