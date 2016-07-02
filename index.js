'use strict';
var vm = require('vm');
var fs = require('fs');
var _ = require('lodash');
var Promise = require('bluebird');
var path = require('path');
Promise.promisifyAll(fs);

var webpack = require('webpack');
var NodeTemplatePlugin = require('webpack/lib/node/NodeTemplatePlugin');
var NodeTargetPlugin = require('webpack/lib/node/NodeTargetPlugin');
var LoaderTargetPlugin = require('webpack/lib/LoaderTargetPlugin');
var LibraryTemplatePlugin = require('webpack/lib/LibraryTemplatePlugin');
var SingleEntryPlugin = require('webpack/lib/SingleEntryPlugin');

const dir = (obj, params) => console.dir(obj, { colors: true, depth: 6 });

function HtmlWebpackPlugin(options) {
  // Default options
  this.options = _.extend({
    template: __dirname + '/default_index.html',
    filename: 'index.html',
    hash: false,
    inject: true,
    compile: true,
    favicon: false,
    minify: false,
    chunks: 'all',
    excludeChunks: [],
    title: 'Webpack App'
  }, options);

  // The passed this.options.template can be a relative filepath such as
  // './template'. That's fine. It will be expanded into an absoulte filepath
  // below using path.resolve
  console.log('initial',this.options.template);

  // If the template doesn't use a loader use the blueimp template loader
  if(this.options.template.indexOf('!') === -1) {
    this.options.template = require.resolve('./loader.js') + '!' + path.resolve(this.options.template);
  }

  // The above code sets the default loader if none is set and resolves the path
  // to the template.
  console.log('after',this.options.template);

  // Resolve template path
  // What this really seems to do is resolve the filepath to the template,
  // regardless of loaders:
  // template: '../../loader.js!./template.html' -> '../../loader.js!/Users/ian/dev/clones/html-webpack-plugin/examples/default/template.html'
  this.options.template = this.options.template.replace(
    /(\!)([^\/\\][^\!\?]+|[^\/\\!?])($|\?.+$)/,
    function(match, prefix, filepath, postfix) {
      // console.log('args', match || '<match>', prefix || '<prefix>', filepath || '<filepath>', postfix || '<postfix>');
      return prefix + path.resolve(filepath) + postfix;
    });
  console.log('final',this.options.template);
}

HtmlWebpackPlugin.prototype.apply = function(compiler) {
  var self = this;
  var compilationPromise;

  // Not sure why we do this since it seems that self.context and
  // compiler.context are the same... maybe there's an edge case I don't know
  // about
  self.context = compiler.context;

  compiler.plugin('make', function(compilation, callback) {
    // Compile the template
    compilationPromise = self.compileTemplate(self.options.template, self.options.filename, compilation)
      .catch(function(err) {
        return new Error(err);
      })
      .then((result) => {
        console.log('Template compiled');
        // dir(result)
        return result;
      })
      .finally(callback);
  });

  compiler.plugin('emit', function(compilation, callback) {
    // Get all chunks
    var chunks = self.filterChunks(compilation.getStats().toJson(), self.options.chunks, self.options.excludeChunks);

    // Get assets
    var assets = self.htmlWebpackPluginAssets(compilation, chunks);
    Promise.resolve()
      // Favicon
      .then(function() {
        if (self.options.favicon) {
          return self.addFileToAssets(self.options.favicon, compilation)
            .then(function(faviconBasename){
              assets.favicon = faviconBasename;
            });
        }
      })
      // Wait for the compilation to finish
      .then(function() {
        return compilationPromise;
      })
      .then(function(resultAsset) {
        if (resultAsset instanceof Error) {
          return Promise.reject(resultAsset);
        }
        // Allow to use a custom function / string instead
        if (self.options.templateContent) {
          return self.options.templateContent;
        }
        console.log('resultAsset');
        dir(resultAsset)
        // Once everything is compiled evaluate the html factory
        // and replace it with its content
        return self.evaluateCompilationResult(compilation, resultAsset);
      })
      // Execute the template
      .then(function(compilationResult) {
        console.log('compilationResult');
        dir(compilationResult)
        // If the loader result is a function execute it to retreive the html
        // otherwise use the returned html
        return typeof compilationResult !== 'function' ? compilationResult :
          self.executeTemplate(compilationResult, chunks, assets, compilation);
      })
      .then(function(html) {
        console.log('html');
        dir(html)

        // console.log('compilation.assets');
        // console.log(compilation.assets[self.options.filename].source())
        // Add the stylesheets, scripts and so on to the resulting html
        return self.postProcessHtml(html, assets);
      })
      .catch(function(err) {
        // In case anything went wrong the promise is resolved
        // with the error message and an error is logged
        var errorMessage = "HtmlWebpackPlugin " + err;
        compilation.errors.push(new Error(errorMessage));
        return errorMessage;
      })
      .then(function(html) {
        console.log('finalHtml');
        dir(html)
        // Replace the compilation result with the evaluated html code
        compilation.assets[self.options.filename] = {
          source: function() {
            return html;
          },
          size: function() {
            return html.length;
          }
        };
        callback();
      });
    });
};

/**
 * Returns the child compiler name
 */
HtmlWebpackPlugin.prototype.getCompilerName = function() {
  var absolutePath = path.resolve(this.context, this.options.filename);
  var relativePath = path.relative(this.context, absolutePath);
  return 'html-webpack-plugin for "' + (absolutePath.length < relativePath.length ? absolutePath : relativePath) + '"';
};

/**
 * Compiles the template into a nodejs factory, adds its to the compilation.assets
 * and returns a promise of the result asset object.
 */
HtmlWebpackPlugin.prototype.compileTemplate = function(template, outputFilename, compilation) {
  // template will be the loader + resolved template path as defined in the
  // constructor
  // outputFilename will be a simple filename string such as index.html
  // copmilation is the actual compilation as you'd expect

  // The entry file is just an empty helper as the dynamic template
  // require is added in "loader.js"
  var outputOptions = {
    filename: outputFilename,
    publicPath: compilation.outputOptions.publicPath
  };
  console.log(template, '|', outputFilename, '|', '<compilation>');

  // outputOptions.publicPath is taken directly from the webpack config of the
  // user
  // dir(outputOptions);

  // Create an additional child compiler which takes the template
  // and turns it into an Node.JS html factory.
  // This allows us to use loaders during the compilation
  var compilerName = this.getCompilerName();

  console.log(`"${compilerName}"`);

  var childCompiler = compilation.createChildCompiler(compilerName, outputOptions);
  childCompiler.apply(
    // Not sure...
    // new NodeTemplatePlugin(outputOptions),

    // Not sure...
    // new NodeTargetPlugin(),

    // This places a line at the result of the compilation
    // var HTML_WEBPACK_PLUGIN_RESULT =
    // That seems to be how the module would be placed into a "Library" of the
    // name HTML_WEBPACK_PLUGIN_RESULT. 'var' seems to be the library export
    // strategy to use. Anyway, this line is later forcably removed so i'm not
    // clear on why it is included in the first place.
    // new LibraryTemplatePlugin('HTML_WEBPACK_PLUGIN_RESULT', 'var'),

    // Important, pass in the template to compile
    new SingleEntryPlugin(this.context, template),

    // Not sure...
    // new LoaderTargetPlugin('node'),

    // A simple define plugin. However, it's not clear to me how this ends up
    // in the main bundle as well since it would seem we are only applying this
    // to the child compiler... hm. Oh well, go with it for now.
    new webpack.DefinePlugin({ HTML_WEBPACK_PLUGIN : 'true' })
  );

  // Create a subCache (copied from https://github.com/SanderSpies/extract-text-webpack-plugin/blob/master/loader.js)
  childCompiler.plugin('compilation', function(compilation) {
    if(compilation.cache) {
      if(!compilation.cache[compilerName]) {
        compilation.cache[compilerName] = {};
      }
      compilation.cache = compilation.cache[compilerName];
    }
  });
  // Compile and return a promise
  return new Promise(function (resolve, reject) {
    childCompiler.runAsChild(function(err, entries, childCompilation) {
      // Resolve / reject the promise
      if (childCompilation.errors && childCompilation.errors.length) {
        var errorDetails = childCompilation.errors.map(function(error) {
            return error.message + (error.error ? ':\n' + error.error: '');
          }).join('\n');

        reject('Child compilation failed:\n' + errorDetails);
      } else {
        resolve(compilation.assets[outputFilename]);
      }
    });
  });
};

/**
 * Evaluates the child compilation result
 * Returns a promise
 */
HtmlWebpackPlugin.prototype.evaluateCompilationResult = function(compilation, compilationResult) {
  if(!compilationResult) {
    return Promise.reject('The child compilation didn\'t provide a result');
  }
  var source = compilationResult.source();

  console.log('raw source', '\n', source);
  // The LibraryTemplatePlugin stores the template result in a local variable.
  // To extract the result during the evaluation this part has to be removed.
  //
  // See my note above. it doesn't seem necessary to use the librarytemplate
  // plugin which makes this line also unecessary
  // source = source.replace('var HTML_WEBPACK_PLUGIN_RESULT =', '');

  // Evaluate the source to either a function or a string. Generally this should
  // probably evaluate to the template function you want to call to get the
  // final markup.
  var newSource;
  try {
    newSource = vm.runInThisContext(source);
  } catch (e) {
    // Log syntax error
    var syntaxError = require('syntax-error')(source);
    var errorMessage = 'Template compilation failed: ' + e +
      (syntaxError ? '\n' + syntaxError + '\n\n\n' + source.split('\n').map(function(row, i) {
        return (1 + i) + '  - ' + row;
      }).join('\n') : '');
    compilation.errors.push(new Error(errorMessage));
    return Promise.reject(e);
  }
  return typeof newSource === 'string' || typeof newSource === 'function' ?
    Promise.resolve(newSource) :
    Promise.reject('The loader "' + this.options.template + '" didn\'t return html.');
};

/**
 * Html post processing
 *
 * Returns a promise
 */
HtmlWebpackPlugin.prototype.executeTemplate = function(templateFunction, chunks, assets, compilation) {
  var self = this;
  return Promise.resolve()
    // Template processing
    .then(function() {
      var templateParams = {
        webpack: compilation.getStats().toJson(),
        webpackConfig: compilation.options,
        htmlWebpackPlugin: {
          files: assets,
          options: self.options,
        }
      };
      var html = '';
      try {
        html = templateFunction(templateParams);
      } catch (e) {
        compilation.errors.push(new Error('Template execution failed: ' + e));
        return Promise.reject(e);
      }
      return html;
    });
};

/**
 * Html post processing
 *
 * Returns a promise
 */
HtmlWebpackPlugin.prototype.postProcessHtml = function(html, assets) {
  var self = this;
  return Promise.resolve()
    // Inject
    .then(function() {
      if (self.options.inject) {
        return self.injectAssetsIntoHtml(html, assets);
      } else {
        return html;
      }
    })
    // Minify
    .then(function(html) {
      if (self.options.minify) {
        var minify = require('html-minifier').minify;
        try {
          return minify(html, this.options.minify);
        } catch(e) {
          Promise.reject(e);
        }
      }
      return html;
    });
};

/*
 * Pushes the content of the given filename to the compilation assets
 */
HtmlWebpackPlugin.prototype.addFileToAssets = function(filename, compilation) {
  return Promise.props({
    size: fs.statAsync(filename),
    source: fs.readFileAsync(filename)
  })
  .catch(function() {
    return Promise.reject(new Error('HtmlWebpackPlugin: could not load file ' + filename));
  })
  .then(function(results) {
    var basename = path.basename(filename);
    compilation.fileDependencies.push(filename);
    compilation.assets[basename] = {
      source: function() {
        return results.source;
      },
      size: function() {
        return results.size.size;
      }
    };
    return basename;
  });
};

/**
 * Return all chunks from the compilation result which match the exclude and include filters
 */
HtmlWebpackPlugin.prototype.filterChunks = function (webpackStatsJson, includedChunks, excludedChunks) {
  var chunks = webpackStatsJson.chunks.filter(function(chunk){
    var chunkName = chunk.names[0];
    // This chunk doesn't have a name. This script can't handled it.
    if (chunkName === undefined) {
      return false;
    }
    // Skip if the chunks should be filtered and the given chunk was not added explicity
    if (Array.isArray(includedChunks) && includedChunks.indexOf(chunkName) === -1) {
      return false;
    }
    // Skip if the chunks should be filtered and the given chunk was excluded explicity
    if (Array.isArray(excludedChunks) && excludedChunks.indexOf(chunkName) !== -1) {
      return false;
    }
    // Add otherwise
    return true;
  });
  return chunks.sort(function orderEntryLast(a, b) {
    if (a.entry !== b.entry) {
      return b.entry ? 1 : -1;
    } else {
      return b.id - a.id;
    }
  });
};

HtmlWebpackPlugin.prototype.htmlWebpackPluginAssets = function(compilation, chunks) {
  var self = this;
  var webpackStatsJson = compilation.getStats().toJson();

  // Use the configured public path or build a relative path
  var publicPath = typeof compilation.options.output.publicPath !== 'undefined' ?
      compilation.options.output.publicPath :
      path.relative(path.dirname(self.options.filename), '.');

  if (publicPath.length && publicPath.substr(-1, 1) !== '/') {
    publicPath += '/';
  }

  var assets = {
    // Will contain all js & css files by chunk
    chunks: {},
    // Will contain all js files
    js: [],
    // Will contain all css files
    css: [],
    // Will contain the html5 appcache manifest files if it exists
    manifest: Object.keys(compilation.assets).filter(function(assetFile){
      return path.extname(assetFile) === '.appcache';
    })[0]
  };

  // Append a hash for cache busting
  if (this.options.hash) {
    assets.manifest = self.appendHash(assets.manifest, webpackStatsJson.hash);
    assets.favicon = self.appendHash(assets.favicon, webpackStatsJson.hash);
  }

  for (var i = 0; i < chunks.length; i++) {
    var chunk = chunks[i];
    var chunkName = chunk.names[0];

    assets.chunks[chunkName] = {};

    // Prepend the public path to all chunk files
    var chunkFiles = [].concat(chunk.files).map(function(chunkFile) {
      return publicPath + chunkFile;
    });

    // Append a hash for cache busting
    if (this.options.hash) {
      chunkFiles = chunkFiles.map(function(chunkFile) {
        return self.appendHash(chunkFile, webpackStatsJson.hash);
      });
    }

    // Webpack outputs an array for each chunk when using sourcemaps
    // But we need only the entry file
    var entry = chunkFiles[0];
    assets.chunks[chunkName].size = chunk.size;
    assets.chunks[chunkName].entry = entry;
    assets.js.push(entry);

    // Gather all css files
    var css = chunkFiles.filter(function(chunkFile){
      // Some chunks may contain content hash in their names, for ex. 'main.css?1e7cac4e4d8b52fd5ccd2541146ef03f'.
      // We must proper handle such cases, so we use regexp testing here
      return /^.css($|\?)/.test(path.extname(chunkFile));
    });
    assets.chunks[chunkName].css = css;
    assets.css = assets.css.concat(css);
  }

  // Duplicate css assets can occur on occasion if more than one chunk
  // requires the same css.
  assets.css = _.uniq(assets.css);

  return assets;
};

/**
 * Injects the assets into the given html string
 */
HtmlWebpackPlugin.prototype.injectAssetsIntoHtml = function(html, assets) {
  var chunks = Object.keys(assets.chunks);

  // Gather all css and script files
  var styles = [];
  var scripts = [];
  chunks.forEach(function(chunkName) {
    styles = styles.concat(assets.chunks[chunkName].css);
    scripts.push(assets.chunks[chunkName].entry);
  });
  // Turn script files into script tags
  scripts = scripts.map(function(scriptPath) {
    return '<script src="' + scriptPath + '"></script>';
  });
  // Turn css files into link tags
  styles = styles.map(function(stylePath) {
    return '<link href="' + stylePath + '" rel="stylesheet">';
  });
  // Injections
  var head = [];
  var body = [];

  // If there is a favicon present, add it to the head
  if (assets.favicon) {
    head.push('<link rel="shortcut icon" href="' + assets.favicon + '">');
  }
  // Add styles to the head
  head = head.concat(styles);
  // Add scripts to body or head
  if (this.options.inject === 'head') {
    head = head.concat(scripts);
  } else {
    body = body.concat(scripts);
  }
  // Append assets to head element
  html = html.replace(/(<\/head>)/i, function (match) {
    return head.join('') + match;
  });
  // Append assets to body element
    html = html.replace(/(<\/body>)/i, function (match) {
      return body.join('') + match;
    });
  // Inject manifest into the opening html tag
  if (assets.manifest) {
    html = html.replace(/(<html[^>]*)(>)/i, function (match, start, end) {
      // Append the manifest only if no manifest was specified
      if (/\smanifest\s*=/.test(match)) {
        return match;
      }
      return start + ' manifest="' + assets.manifest + '"' + end;
    });
  }
  return html;
};

/**
 * Appends a cache busting hash
 */
HtmlWebpackPlugin.prototype.appendHash = function (url, hash) {
  if (!url) {
    return url;
  }
  return url + (url.indexOf('?') === -1 ? '?' : '&') + hash;
};


module.exports = HtmlWebpackPlugin;
