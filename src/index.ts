import path from "path";
import fs from "fs";
import { HTTPRequest, HTTPResponse, Page } from "puppeteer";
import { PuppeteerExtraPlugin } from "puppeteer-extra-plugin";

type CocproxyPluginOptions = {
  mode: "proxy" | "offline";
  filesDir: string;
};

class Plugin extends PuppeteerExtraPlugin {
  constructor(opts: Partial<CocproxyPluginOptions> = {}) {
    super(opts);
  }

  get name() {
    return "cocproxy";
  }

  get defaults() {
    return {
      mode: "proxy",
      filesDir: "./files",
    };
  }

  get mode() {
    return this.opts.mode;
  }

  get filesDir() {
    return this.opts.filesDir;
  }

  /**
   * @private
   */
  async onPageCreated(page: Page) {
    this.debug("onPageCreated", { mode: this.mode });
    await page.setRequestInterception(true);
    page.on("request", this.onRequest.bind(this));
    page.on("response", this.onResponse.bind(this));
  }

  private _alreadyCachedRequestIds = new Set<string>();

  /**
   * @private
   */
  onRequest(request: HTTPRequest) {
    const url = request.url();
    const localPath = this.buildLocalPath(url);
    const fileExists = fs.existsSync(localPath);

    this.debug("onRequest", { url, localPath, fileExists });

    if (fileExists) {
      request.respond({
        status: 200,
        body: fs.readFileSync(localPath),
      });
      this._alreadyCachedRequestIds.add(request._requestId);
    } else {
      request.continue();
    }
  }

  onResponse(response: HTTPResponse) {
    const request = response.request();
    const originalURL = request.url();
    const localPath = this.buildLocalPath(originalURL);
    const alreadyCached = this._alreadyCachedRequestIds.has(request._requestId);

    this.debug("onResponse", { originalURL, localPath, alreadyCached });

    if (alreadyCached) {
      this._alreadyCachedRequestIds.delete(request._requestId);
    } else {
      response
        .buffer()
        .then((buffer) => {
          fs.mkdirSync(path.dirname(localPath), { recursive: true });
          fs.writeFileSync(localPath, buffer);
        })
        .catch((error) => {
          throw error;
        });
    }
  }

  buildLocalPath(url: string): string {
    const { host, pathname, search } = new URL(url);
    const localPath = path.join(this.filesDir, host, pathname);
    if (localPath.endsWith("/")) {
      return localPath + "index.html";
    } else {
      return localPath;
    }
  }
}

module.exports = function (pluginConfig: Partial<CocproxyPluginOptions>) {
  return new Plugin(pluginConfig);
};
