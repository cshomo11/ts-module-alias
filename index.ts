import Path from 'path';

export type FuncNodeModulePaths = (from: string) => string[]
export type FuncResolveFileName = (request: string, parent: NodeModule, ...args: unknown[]) => string

export interface ModuleAliasDict {
  [key: string]: ((from: string, request: string, alias: string) => string) | string
}

export type NodeModuleConstructor =
  (new (...args: any[]) => NodeModule)
  & {
    _cache: { [key: string]: NodeModule }
    _contextLoad: boolean
    _debug: unknown
    _extensions: { [key: string]: string }
    _findPath: (request: string, paths: string[]) => string | false
    _load: (request: string, parent: NodeModule, isMain: boolean) => unknown
    _nodeModulePaths: FuncNodeModulePaths
    _pathCache: { [key: string]: string }
    _realPathCache: unknown
    _resolveFilename: FuncResolveFileName
    _resolveLookupPaths: (request: string, parent: NodeModule) => [string, string[]]

    _moduleAlias?: ModuleAlias

    globalPaths: string[]
    wrapper: unknown
    wrap: unknown
  }

export interface ModuleAliasOptions {
  base?: string
}

/**
 * Implements the module-alias library, which allows programmatic configuration of module resolution rules,
 * as a transient class which applies to the calling module.
 */
export class ModuleAlias {
  /**
   * The module used by the module resolver.
   */
  private module: NodeModule
  /**
   * The module class used by the module resolver.
   */
  private ModuleCtor: NodeModuleConstructor
  /**
   * Captured instance of the old _nodeModulePaths function.
   */
  private oldNodeModulePaths: FuncNodeModulePaths
  /**
   * Captured instance of the old _resolveFilename function
   */
  private oldResolveFilename: FuncResolveFileName


  /**
   * A list of paths for which modules are searched.
   */
  private modulePaths: string[] = [];
  /**
   * A dictionary of aliases and their expanded path representations.
   */
  private moduleAliases: ModuleAliasDict = {};
  /**
   * A list of aliases.
   */
  private moduleAliasNames: string[] = [];


  constructor (parent?: NodeModule, givenOptions?: ModuleAliasOptions | string) {
    // Guard against poorly mocked module constructors
    if (parent) {
      this.module = parent;
      this.ModuleCtor = parent.constructor as NodeModuleConstructor;
    } else if (module.parent) {
      this.module = module.parent;
      this.ModuleCtor = module.parent.constructor as NodeModuleConstructor;
    } else {
      throw new Error('Failed to initialize ts-module-alias.  `parent` was not defined and a suitable substitute could not be found.');
    }

    // Guard against initializing on the same module
    if (this.ModuleCtor._moduleAlias) {
      return this.ModuleCtor._moduleAlias;
    }

    this.oldNodeModulePaths = this.ModuleCtor._nodeModulePaths;
    this.oldResolveFilename = this.ModuleCtor._resolveFilename;

    const self = this;
    this.ModuleCtor._nodeModulePaths = (from) => self.nodeModulePaths(self, from);
    this.ModuleCtor._resolveFilename = (request, parent, ...args) => self.resolveFilename(self, request, parent, ...args);

    let options: ModuleAliasOptions;
    if (typeof givenOptions === 'string') {
      options = { base: givenOptions };
    } else {
      options = givenOptions || {};
    }

    let candidatePackagePaths;
    if (options.base) {
      candidatePackagePaths = [Path.resolve(options.base.replace(/\/package\.json$/, ''))]
    } else {
      // There is probably 99% chance that the project root directory in located
      // above the node_modules directory,
      // Or that package.json is in the node process' current working directory (when
      // running a package manager script, e.g. `yarn start` / `npm run start`)
      candidatePackagePaths = [Path.join(__dirname, '../..'), process.cwd()];
    }

    let npmPackage;
    let base: string;
    for (let i in candidatePackagePaths) {
      try {
        base = candidatePackagePaths[i];
        npmPackage = require(Path.join(base, 'package.json'));
        break;
      } catch (e) {
        // noop
      }
    }
    base = base || __dirname;

    if (typeof npmPackage !== 'object') {
      let pathString = candidatePackagePaths.join(',\n');
      throw new Error(`Unable to find package.json in any of:\n[${pathString}]`);
    }

    //
    // Import aliases
    //

    let aliases = {
      ...npmPackage._moduleAliases
    }

    for (let alias in aliases) {
      if (Path.isAbsolute(aliases[alias])) {
        aliases[alias] = Path.join(base, aliases[alias]);
      }
    }

    this.addAliases(aliases);

    //
    // Register custom module directories (like node_modules)
    //

    if (npmPackage._moduleDirectories instanceof Array) {
      npmPackage._moduleDirectories.forEach((dir: string) => {
        if (dir === 'node_modules') return;

        let modulePath = Path.join(base, dir);
        this.addPath(modulePath);
      });
    }

    this.ModuleCtor._moduleAlias = this;
  }

  /**
   * Adds a path to the source directories to search for modules
   *
   * @param path The path which should be used as a source directory
   */
  addPath (path: string): void {
    path = Path.normalize(path);

    if (this.modulePaths.indexOf(path) === -1) {
      this.modulePaths.unshift(path);
      this.addPathHelper(path, this.module.paths);
    }
  }

  /**
   * Adds an alias to a path
   *
   * @param alias Path alias
   * @param target Actual path
   */
  addAlias (alias: string, target: string) {
    this.moduleAliases[alias] = target;
    // Cost of sorting is lower here than during resolution
    this.moduleAliasNames = Object.keys(this.moduleAliases);
    this.moduleAliasNames.sort();
  }

  /**
   * Adds many aliases to paths
   *
   * @param aliases An object containing paths keyed by their alias.
   */
  addAliases (aliases: { [key: string]: string }) {
    for (let alias in aliases) {
      this.addAlias(alias, aliases[alias]);
    }
  }

  /**
   * Checks if the import request matches to an alias
   * @param path Import request
   * @param alias A path alias
   */
  isPathMatchesAlias (path: string, alias: string): boolean {
      // Matching /^alias(\/|$)/
      return path.indexOf(alias) === 0
        && (path.length === alias.length || path[alias.length] === '/');
  }

  /**
   * Normalizes a path and adds it to an array if it is not already present
   * NOTE: feels redundant, idk, might delete later
   *
   * @param path The path to be added to an array
   * @param targetArray The array to which the path should be added
   */
  private addPathHelper (path: string, targetArray: string[]) {
    path = Path.normalize(path);
    if (targetArray && targetArray.indexOf(path) === -1) {
      targetArray.unshift(path);
    }
  }

  /**
   * Overloads the _nodeModulePaths function on the module system
   *
   * @param this unknown
   * @param self Instance of current ModuleAlias class
   * @param from The path of the requesting module
   */
  private nodeModulePaths(this: unknown, self: this, from: string): string[] {
    let paths = self.oldNodeModulePaths.call(this, from);

    // Only include the module path for top-level modules
    // that were not installed:
    if (from.indexOf('node_modules') === -1) {
      paths = self.modulePaths.concat(paths);
    }

    return paths;
  }

  /**
   * Overloads the _resolveFilename function on the module system
   *
   * @param this unknown
   * @param self Instance of current ModuleAlias class
   * @param request Import request string e.g. 'path', 'fs' or 'src/path/to/file'
   * @param parent The module making this request
   * @param args Further arguments, irrelevant to what this is doing
   */
  private resolveFilename(this: unknown, self: this, request: string, parent: NodeModule, ...args: unknown[]): string {
    for (let i = self.moduleAliasNames.length; i-- > 0;) {
      let alias = self.moduleAliasNames[i];
      if (self.isPathMatchesAlias(request, alias)) {
        let aliasTarget = self.moduleAliases[alias];
        // Custom function handler
        if (typeof self.moduleAliases[alias] === 'function') {
          let fromPath = parent.filename;
          aliasTarget = (self.moduleAliases[alias] as any)(fromPath, request, alias);
          if (!aliasTarget || typeof aliasTarget !== 'string') {
            throw new Error('[module-alias] Expecting custom handler function to return path.');
          }
        }
        request = Path.join(aliasTarget as string, request.substr(alias.length));
        // Only use the first match
        break;
      }
    }

    // Modify parent before passing to guarantee that module paths are included.
    // This is kind of a hack to fix an issue with parent paths not populating correctly after hot-module reload.
    //   Cause of actual bug is unknown, but this makes things work.
    const paths: { [key: string]: boolean } = {};
    const moduleAndParentPaths = parent?.paths ? [...self.modulePaths, ...parent.paths] : self.modulePaths;
    for (let path of moduleAndParentPaths) {
      paths[path] = true;
    }
    if (parent) {
      parent.paths = Object.keys(paths);
    }

    return self.oldResolveFilename.call(this, request, parent, ...args);
  }
}
export default ModuleAlias;
