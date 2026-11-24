import test from 'node:test';
import assert from 'node:assert/strict';
import { Marked } from 'marked';
import { readChatGPTCss, readChatGPTSvg, chatGPTMermaidExtension } from '../src/chatgpt-mermaid.js';

const selector = '#chatgpt-mermaid-_r_11p_';
const css = selector + '{font-family:"Segoe UI";font-size:16px;}'
    + '@keyframes edge-animation-frame{from{stroke-dashoffset:0;}}'
    + '@keyframes dash{to{stroke-dashoffset:0;}}'
    + selector + ' .node rect,' + selector + ' .node circle{fill:rgb(14, 32, 61);}'
    + selector + ' :root{--mermaid-font-family:"{system}";}';
const labels = 'Capital and computingresourcesMore capable AIAI-assisted AI research';

test('recognizes ChatGPT stylesheet and preserves concatenated labels verbatim', () => {
    assert.deepEqual(readChatGPTCss(css + labels), {
        id: selector.slice(1), cssEnd: css.length, labels
    });
    assert.equal(readChatGPTCss('#other{color:red}'), null);
    assert.equal(readChatGPTCss(selector + '{font-size:16px'), null);
});

test('bare dump is a Markdown block; following heading and prose survive', () => {
    const parser = new Marked({ extensions: [chatGPTMermaidExtension(() => '<diagram/>\n')] });
    assert.equal(parser.parse('Intro\n' + css + labels + '\n\n## Next\nText'),
        '<p>Intro</p>\n<diagram/>\n<h2>Next</h2>\n<p>Text</p>\n');
    assert.match(parser.parse('```js\n' + css + '\n```'), /<pre><code class="language-js">/);
});

test('recognizes a raw SVG including nested SVG elements', () => {
    const svg = '<svg id="chatgpt-mermaid-example"><g><svg><rect/></svg></g></svg>';
    assert.equal(readChatGPTSvg(svg + '\nAfter'), svg);
    assert.equal(readChatGPTSvg('<svg id="ordinary"><rect/></svg>'), null);
});
