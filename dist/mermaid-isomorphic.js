import { chromium } from 'playwright';
const html = import.meta.resolve('../index.html');
const mermaidScript = {
    url: import.meta.resolve('mermaid/dist/mermaid.js')
};
const faStyle = {
    // We use url, not path. If we use path, the fonts can’t be resolved.
    url: import.meta.resolve('@fortawesome/fontawesome-free/css/all.css')
};
/* c8 ignore start */
/**
 * Render mermaid diagrams in the browser.
 *
 * @param options
 *   The options used to render the diagrams
 * @returns
 *   A settled promise that holds the rendering results.
 */
async function renderDiagrams({ diagrams, mermaidConfig, prefix, screenshot }) {
    await Promise.all(Array.from(document.fonts, (font) => font.load()));
    const parser = new DOMParser();
    const serializer = new XMLSerializer();
    mermaid.initialize(mermaidConfig);
    /**
     * Get an aria value form a referencing attribute.
     *
     * @param element
     *   The SVG element the get the value from.
     * @param attribute
     *   The attribute whose value to get.
     * @returns
     *   The aria value.
     */
    // eslint-disable-next-line unicorn/consistent-function-scoping
    function getAriaValue(element, attribute) {
        const value = element.getAttribute(attribute);
        if (!value) {
            return;
        }
        let result = '';
        for (const id of value.split(/\s+/)) {
            const node = element.getElementById(id);
            if (node) {
                result += node.textContent;
            }
        }
        return result;
    }
    return Promise.allSettled(diagrams.map(async (diagram, index) => {
        const id = `${prefix}-${index}`;
        try {
            const { svg } = await mermaid.render(id, diagram);
            const root = parser.parseFromString(svg, 'text/html');
            const [element] = root.getElementsByTagName('svg');
            const { height, width } = element.viewBox.baseVal;
            const description = getAriaValue(element, 'aria-describedby');
            const title = getAriaValue(element, 'aria-labelledby');
            if (screenshot) {
                document.body.append(element);
            }
            const result = {
                height,
                id,
                svg: serializer.serializeToString(element),
                width
            };
            if (description) {
                result.description = description;
            }
            if (title) {
                result.title = title;
            }
            return result;
        }
        catch (error) {
            throw error instanceof Error
                ? { name: error.name, stack: error.stack, message: error.message }
                : error;
        }
    }));
}
/**
 * Launch a browser and a single browser context.
 *
 * @param browserType
 *   The browser type to launch.
 * @param launchOptions
 *   Optional launch options
 * @returns
 *   A simple browser context wrapper
 */
async function getBrowser(browserType, launchOptions) {
    const browser = await browserType.launch(launchOptions);
    const context = await browser.newContext({ bypassCSP: true });
    return {
        async close() {
            await context.close();
            await browser.close();
        },
        newPage() {
            return context.newPage();
        }
    };
}
/**
 * Create a Mermaid renderer.
 *
 * The Mermaid renderer manages a browser instance. If multiple diagrams are being rendered
 * simultaneously, the internal browser instance will be re-used. If no diagrams are being rendered,
 * the browser will be closed.
 *
 * @param options
 *   The options of the Mermaid renderer.
 * @returns
 *   A function that renders Mermaid diagrams in the browser.
 */
export function createMermaidRenderer(options = {}) {
    const { browserType = chromium, launchOptions } = options;
    let browserPromise;
    let count = 0;
    return async (diagrams, renderOptions) => {
        count += 1;
        if (!browserPromise) {
            browserPromise = getBrowser(browserType, launchOptions);
        }
        const context = await browserPromise;
        let page;
        let renderResults;
        try {
            page = await context.newPage();
            page.setDefaultTimeout(300_000);
            page.setDefaultNavigationTimeout(300_000);
            await page.goto(html);
            const promises = [page.addStyleTag(faStyle), page.addScriptTag(mermaidScript)];
            const css = renderOptions?.css;
            if (typeof css === 'string' || css instanceof URL) {
                promises.push(page.addStyleTag({ url: String(css) }));
            }
            else if (css) {
                for (const url of css) {
                    promises.push(page.addStyleTag({ url: String(url) }));
                }
            }
            await Promise.all(promises);
            renderResults = await page.evaluate(renderDiagrams, {
                diagrams,
                screenshot: Boolean(renderOptions?.screenshot),
                mermaidConfig: {
                    fontFamily: 'arial,sans-serif',
                    ...renderOptions?.mermaidConfig
                },
                prefix: renderOptions?.prefix ?? 'mermaid'
            });
            if (renderOptions?.screenshot) {
                for (const result of renderResults) {
                    if (result.status === 'fulfilled') {
                        result.value.screenshot = await page
                            .locator(`#${result.value.id}`)
                            .screenshot({ omitBackground: true });
                    }
                }
            }
        }
        finally {
            await page?.close();
            count -= 1;
            if (!count) {
                browserPromise = undefined;
                context.close();
            }
        }
        for (const result of renderResults) {
            if (result.status !== 'rejected') {
                continue;
            }
            const { reason } = result;
            if (reason && 'name' in reason && 'message' in reason && 'stack' in reason) {
                Object.setPrototypeOf(reason, Error.prototype);
            }
        }
        return renderResults;
    };
}
//# sourceMappingURL=mermaid-isomorphic.js.map