import path from "path";
import fs from "fs";
import { HTTPRequest, HTTPResponse, Page } from "puppeteer";
import { PuppeteerExtraPlugin } from "puppeteer-extra-plugin";

export type CocproxyPluginOptions = {
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

  get mode(): CocproxyPluginOptions["mode"] {
    return this.opts.mode;
  }

  get filesDir(): CocproxyPluginOptions["filesDir"] {
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

    this.debug("onRequest", {
      requestId: request._requestId,
      method: request.method(),
      url,
      localPath,
      fileExists,
    });

    if (fileExists) {
      request.respond({
        status: 200,
        body: fs.readFileSync(localPath),
      });
      this._alreadyCachedRequestIds.add(request._requestId);
    } else {
      if (this.mode === "offline") {
        this.debug("request.abort");
        request.abort();
      } else {
        this.debug("request.continue");
        request.continue();
      }
    }
  }

  onResponse(response: HTTPResponse) {
    const request = response.request();
    const originalURL = request.url();
    const localPath = this.buildLocalPath(originalURL);
    const alreadyCached = this._alreadyCachedRequestIds.has(request._requestId);

    this.debug("onResponse", {
      requestId: request._requestId,
      originalURL,
      localPath,
      alreadyCached,
      header: response.headers(),
    });

    if (alreadyCached) {
      this._alreadyCachedRequestIds.delete(request._requestId);
    } else if (response.status() >= 200 && response.status() < 300) {
      if (response.headers()["content-length"] === "0") {
        // Avoid `Protocol error (Network.getResponseBody): No resource with given identifier found`
        this.debug("Content is empty");
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        fs.writeFileSync(localPath, "");
      } else {
        response
          .buffer()
          .then((buffer) => {
            fs.mkdirSync(path.dirname(localPath), { recursive: true });
            fs.writeFileSync(localPath, buffer);
          })
          .catch((error) => {
            this.debug("error", { originalURL });
            throw error;
          });
      }
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

export default function (pluginConfig: Partial<CocproxyPluginOptions>) {
  return new Plugin(pluginConfig);
}
