import Storehouse from 'storehouse-js';
import * as monaco from 'monaco-editor';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import mermaid from 'mermaid';

const init = () => {
    let hasEdited = false;
    let scrollBarSync = false;

    const localStorageNamespace = 'com.markdownlivepreview';
    const localStorageKey = 'last_state';
    const localStorageScrollBarKey = 'scroll_bar_settings';
    const localStorageThemeKey = 'theme_settings';
    const confirmationMessage = 'Are you sure you want to reset? Your changes will be lost.';
    let mermaidRenderTimer = null;
    let mermaidRenderVersion = 0;
    // default template
    const defaultInput = `# Markdown syntax guide

## Headers

# This is a Heading h1
## This is a Heading h2
###### This is a Heading h6

## Emphasis

*This text will be italic*  
_This will also be italic_

**This text will be bold**  
__This will also be bold__

_You **can** combine them_

## Lists

### Unordered

* Item 1
* Item 2
* Item 2a
* Item 2b
    * Item 3a
    * Item 3b

### Ordered

1. Item 1
2. Item 2
3. Item 3
    1. Item 3a
    2. Item 3b

## Images

![This is an alt text.](/image/Markdown-mark.svg "This is a sample image.")

## Links

You may be using [Markdown Live Preview](https://markdownlivepreview.com/).

## Blockquotes

> Markdown is a lightweight markup language with plain-text-formatting syntax, created in 2004 by John Gruber with Aaron Swartz.
>
>> Markdown is often used to format readme files, for writing messages in online discussion forums, and to create rich text using a plain text editor.

## Tables

| Left columns  | Right columns |
| ------------- |:-------------:|
| left foo      | right foo     |
| left bar      | right bar     |
| left baz      | right baz     |

## Blocks of code

${"`"}${"`"}${"`"}
let message = 'Hello world';
alert(message);
${"`"}${"`"}${"`"}

## Mermaid diagrams
${"`"}${"`"}${"`"}mermaid
graph TD
  A[Start] --> B{Decision}
  B -->|Yes| C[Finish]
  B -->|No| D[Alternate]
${"`"}${"`"}${"`"}

## Inline code

This web site is using ${"`"}markedjs/marked${"`"}.
`;

    self.MonacoEnvironment = {
        getWorker(_, label) {
            return new Proxy({}, { get: () => () => { } });
        }
    }

    let setupEditor = () => {
        let editor = monaco.editor.create(document.querySelector('#editor'), {
            fontSize: 14,
            language: 'markdown',
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            scrollbar: {
                vertical: 'visible',
                horizontal: 'visible'
            },
            wordWrap: 'on',
            hover: { enabled: false },
            quickSuggestions: false,
            suggestOnTriggerCharacters: false,
            folding: false
        });

        editor.onDidChangeModelContent(() => {
            let changed = editor.getValue() != defaultInput;
            if (changed) {
                hasEdited = true;
            }
            let value = editor.getValue();
            convert(value);
            saveLastContent(value);
        });

        editor.onDidScrollChange((e) => {
            if (!scrollBarSync) {
                return;
            }

            const scrollTop = e.scrollTop;
            const scrollHeight = e.scrollHeight;
            const height = editor.getLayoutInfo().height;

            const maxScrollTop = scrollHeight - height;
            const scrollRatio = scrollTop / maxScrollTop;

            let previewElement = document.querySelector('#preview');
            let targetY = (previewElement.scrollHeight - previewElement.clientHeight) * scrollRatio;
            previewElement.scrollTo(0, targetY);
        });

        return editor;
    };

    let escapeHtml = (value) => {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    let markAsNotranslatable = (element) => {
        element.setAttribute('translate', 'no');
        element.classList.add('notranslate');
    };

    let protectTranslationSensitiveContent = (root) => {
        root.querySelectorAll('pre, code, .mermaid').forEach(markAsNotranslatable);
    };

    let createMarkedRenderer = () => {
        const renderer = new marked.Renderer();
        const renderCode = renderer.code.bind(renderer);

        renderer.code = (token) => {
            const lang = (token.lang || '').match(/^\S*/)?.[0].toLowerCase();
            if (lang !== 'mermaid') {
                return renderCode(token);
            }

            return `<pre class="mermaid">${escapeHtml(token.text)}</pre>\n`;
        };

        return renderer;
    };

    let configureMermaid = (theme) => {
        mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme
        });
    };

    let showMermaidError = (element, error) => {
        const message = error && error.message ? error.message : 'Unable to render Mermaid chart.';
        element.classList.add('mermaid-error');
        element.textContent = `Mermaid render error: ${message}`;
    };

    let getMermaidTheme = () => {
        return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'default';
    };

    let renderMermaidDiagramsNow = async (theme = getMermaidTheme()) => {
        const outputElement = document.querySelector('#output');
        if (!outputElement) {
            return;
        }

        const version = ++mermaidRenderVersion;
        configureMermaid(theme);

        const elements = Array.from(outputElement.querySelectorAll('.mermaid'));
        for (const [index, element] of elements.entries()) {
            if (version !== mermaidRenderVersion) {
                return;
            }

            const source = element.dataset.mermaidSource || element.textContent;
            element.dataset.mermaidSource = source;
            element.classList.remove('mermaid-error');

            try {
                const renderId = `mermaid-${Date.now()}-${version}-${index}`;
                const { svg, bindFunctions } = await mermaid.render(renderId, source);
                if (version !== mermaidRenderVersion) {
                    return;
                }
                element.innerHTML = svg;
                if (typeof bindFunctions === 'function') {
                    bindFunctions(element);
                }
            } catch (error) {
                showMermaidError(element, error);
            }
        }
    };

    let scheduleMermaidRender = () => {
        if (mermaidRenderTimer) {
            clearTimeout(mermaidRenderTimer);
        }

        mermaidRenderTimer = setTimeout(() => {
            mermaidRenderTimer = null;
            renderMermaidDiagramsNow();
        }, 150);
    };

    let renderMermaidDiagrams = (theme) => {
        if (mermaidRenderTimer) {
            clearTimeout(mermaidRenderTimer);
            mermaidRenderTimer = null;
        }

        return renderMermaidDiagramsNow(theme);
    };

    let renderer = createMarkedRenderer();

    // Render markdown text as html
    let convert = (markdown) => {
        let options = {
            headerIds: false,
            mangle: false,
            renderer
        };
        let html = marked.parse(markdown, options);
        let sanitized = DOMPurify.sanitize(html);
        const outputElement = document.querySelector('#output');
        outputElement.innerHTML = sanitized;
        protectTranslationSensitiveContent(outputElement);
        scheduleMermaidRender();
    };

    // Reset input text
    let reset = () => {
        let changed = editor.getValue() != defaultInput;
        if (hasEdited || changed) {
            var confirmed = window.confirm(confirmationMessage);
            if (!confirmed) {
                return;
            }
        }
        presetValue(defaultInput);
        document.querySelectorAll('.column').forEach((element) => {
            element.scrollTo({ top: 0 });
        });
    };

    let presetValue = (value) => {
        editor.setValue(value);
        editor.revealPosition({ lineNumber: 1, column: 1 });
        editor.focus();
        hasEdited = false;
    };

    // ----- sync scroll position -----

    let initScrollBarSync = (settings) => {
        let checkbox = document.querySelector('#sync-scroll-checkbox');
        checkbox.checked = settings;
        scrollBarSync = settings;

        checkbox.addEventListener('change', (event) => {
            let checked = event.currentTarget.checked;
            scrollBarSync = checked;
            saveScrollBarSettings(checked);
        });
    };

    // ----- preview CSS loader (switch github-markdown css) -----
    const PREVIEW_CSS_LIGHT = 'css/github-markdown-light.css?v=a1a198514565';
    const PREVIEW_CSS_DARK = 'css/github-markdown-dark_dimmed.css?v=5d3f5d9d207c';

    let setPreviewCss = (useDark) => {
        const link = document.getElementById('gh-markdown-link');
        const desired = useDark ? PREVIEW_CSS_DARK : PREVIEW_CSS_LIGHT;
        if (!link) {
            const newLink = document.createElement('link');
            newLink.id = 'gh-markdown-link';
            newLink.rel = 'stylesheet';
            newLink.href = desired;
            document.head.appendChild(newLink);
            return new Promise((resolve) => {
                newLink.addEventListener('load', resolve, { once: true });
                newLink.addEventListener('error', resolve, { once: true });
            });
        }

        if (link.getAttribute('href') === desired) {
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            link.addEventListener('load', resolve, { once: true });
            link.addEventListener('error', resolve, { once: true });
            link.setAttribute('href', desired);
        });
    };

    // ----- theme toggle (dark/light) -----
    let setTheme = (enabled) => {
        document.documentElement.setAttribute('data-theme', enabled ? 'dark' : 'light');
    };

    let initThemeToggle = (settings) => {
        let checkbox = document.querySelector('#theme-checkbox');
        if (!checkbox) return;
        checkbox.checked = settings;
        setTheme(settings);

        // set Monaco editor theme to match page theme
        if (monaco && monaco.editor && typeof monaco.editor.setTheme === 'function') {
            monaco.editor.setTheme(settings ? 'vs-dark' : 'vs');
        }
        // set preview css to match theme
        setPreviewCss(settings);

        checkbox.addEventListener('change', (event) => {
            let checked = event.currentTarget.checked;
            setTheme(checked);
            saveThemeSettings(checked);
            setPreviewCss(checked);
            if (monaco && monaco.editor && typeof monaco.editor.setTheme === 'function') {
                monaco.editor.setTheme(checked ? 'vs-dark' : 'vs');
            }
            renderMermaidDiagrams();
        });
    };

    let enableScrollBarSync = () => {
        scrollBarSync = true;
    };

    let disableScrollBarSync = () => {
        scrollBarSync = false;
    };

    // ----- clipboard utils -----

    let copyToClipboard = (text, successHandler, errorHandler) => {
        navigator.clipboard.writeText(text).then(
            () => {
                successHandler();
            },

            () => {
                errorHandler();
            }
        );
    };

    let notifyCopied = () => {
        let labelElement = document.querySelector("#copy-button a");
        labelElement.innerHTML = "Copied!";
        setTimeout(() => {
            labelElement.innerHTML = "Copy";
        }, 1000)
    };

    // ----- export preview -----

    let restoreMermaidThemeAfterPrint = (theme) => {
        const printMedia = window.matchMedia('print');
        let printSessionStarted = false;

        const cleanup = () => {
            printMedia.removeEventListener('change', handlePrintMediaChange);
        };

        const handlePrintMediaChange = (event) => {
            if (event.matches) {
                printSessionStarted = true;
                return;
            }

            if (!printSessionStarted) {
                return;
            }

            cleanup();
            renderMermaidDiagrams(theme);
        };

        printMedia.addEventListener('change', handlePrintMediaChange);
        return cleanup;
    };

    let exportPreviewToPdf = () => {
        const currentTheme = getMermaidTheme();
        const printTheme = 'default';

        const cleanupPrintThemeListener = currentTheme === 'dark'
            ? restoreMermaidThemeAfterPrint(currentTheme)
            : null;

        renderMermaidDiagrams(printTheme).then(() => {
            window.print();
        }).catch((error) => {
            // eslint-disable-next-line no-console
            console.error('Failed to prepare PDF export', error);
            if (currentTheme === 'dark') {
                cleanupPrintThemeListener();
                renderMermaidDiagrams(currentTheme);
            }
            window.alert('Unable to prepare the print preview. Please try again.');
        });
    };

    // ----- setup -----

    // setup navigation actions
    let setupOpenButton = () => {
        const button = document.querySelector('#open-button');
        const input = document.querySelector('#open-file-input');

        button.addEventListener('click', () => {
            input.click();
        });

        input.addEventListener('change', async () => {
            const file = input.files[0];
            // Allow the same file to be selected again, including after a failed read.
            input.value = '';
            if (!file) return;

            button.disabled = true;
            let content;
            try {
                content = await file.text();
            } catch (error) {
                window.alert('Unable to read this file. Please try again.');
                return;
            } finally {
                button.disabled = false;
            }

            presetValue(content);
            document.querySelector('#preview').scrollTo({ top: 0 });
        });
    };

    let setupResetButton = () => {
        document.querySelector("#reset-button").addEventListener('click', (event) => {
            event.preventDefault();
            reset();
        });
    };

    let setupCopyButton = (editor) => {
        document.querySelector("#copy-button").addEventListener('click', (event) => {
            event.preventDefault();
            let value = editor.getValue();
            copyToClipboard(value, () => {
                notifyCopied();
            },
                () => {
                    // nothing to do
                });
        });
    };

    let setupExportButton = () => {
        const exportButton = document.querySelector('#export-button');
        if (!exportButton) {
            return;
        }
        exportButton.addEventListener('click', (event) => {
            event.preventDefault();
            exportPreviewToPdf();
        });
    };

    // ----- local state -----

    let loadLastContent = () => {
        let lastContent = Storehouse.getItem(localStorageNamespace, localStorageKey);
        return lastContent;
    };

    let saveLastContent = (content) => {
        let expiredAt = new Date(2099, 1, 1);
        Storehouse.setItem(localStorageNamespace, localStorageKey, content, expiredAt);
    };

    let loadScrollBarSettings = () => {
        let lastContent = Storehouse.getItem(localStorageNamespace, localStorageScrollBarKey);
        return lastContent;
    };

    let loadThemeSettings = () => {
        let last = Storehouse.getItem(localStorageNamespace, localStorageThemeKey);
        if (last === null || last === undefined) {
            try {
                // fallback to raw localStorage boot key used by inline script
                const raw = localStorage.getItem('com.markdownlivepreview_theme');
                if (raw === 'dark') return true;
                if (raw === 'light') return false;
            } catch (e) {
                // ignore
            }
        }
        return last;
    };

    let saveScrollBarSettings = (settings) => {
        let expiredAt = new Date(2099, 1, 1);
        Storehouse.setItem(localStorageNamespace, localStorageScrollBarKey, settings, expiredAt);
    };

    let saveThemeSettings = (settings) => {
        let expiredAt = new Date(2099, 1, 1);
        Storehouse.setItem(localStorageNamespace, localStorageThemeKey, settings, expiredAt);
        try {
            localStorage.setItem('com.markdownlivepreview_theme', settings ? 'dark' : 'light');
        } catch (e) {
            // ignore storage errors
        }
    };

    let setupDivider = () => {
        let lastLeftRatio = 0.5;
        const divider = document.getElementById('split-divider');
        const leftPane = document.getElementById('edit');
        const rightPane = document.getElementById('preview');
        const container = document.getElementById('container');
        const minPaneWidth = 100;
        const keyboardStepRatio = 0.05;

        let isDragging = false;
        let activePointerId = null;
        let dragPointerOffset = 0;

        const getDividerMetrics = () => {
            const containerRect = container.getBoundingClientRect();
            const dividerStyle = getComputedStyle(divider);
            const dividerWidth = divider.offsetWidth
                + parseFloat(dividerStyle.marginLeft || 0)
                + parseFloat(dividerStyle.marginRight || 0);
            const availableWidth = Math.max(0, containerRect.width - dividerWidth);
            const effectiveMinPaneWidth = Math.min(minPaneWidth, availableWidth / 2);

            return {
                containerRect,
                dividerWidth,
                availableWidth,
                effectiveMinPaneWidth
            };
        };

        const applyLeftWidth = (requestedLeftWidth, rememberRatio = true) => {
            const metrics = getDividerMetrics();
            if (metrics.availableWidth <= 0) return;

            const maxLeftWidth = metrics.availableWidth - metrics.effectiveMinPaneWidth;
            const leftWidth = Math.max(
                metrics.effectiveMinPaneWidth,
                Math.min(requestedLeftWidth, maxLeftWidth)
            );
            const rightWidth = metrics.availableWidth - leftWidth;
            const actualRatio = leftWidth / metrics.availableWidth;

            leftPane.style.width = leftWidth + 'px';
            rightPane.style.width = rightWidth + 'px';
            divider.setAttribute('aria-valuenow', String(Math.round(actualRatio * 100)));

            if (rememberRatio) {
                lastLeftRatio = actualRatio;
            }
        };

        const finishDragging = (pointerId) => {
            if (!isDragging || (pointerId !== undefined && pointerId !== activePointerId)) return;

            if (activePointerId !== null && divider.hasPointerCapture?.(activePointerId)) {
                divider.releasePointerCapture(activePointerId);
            }

            isDragging = false;
            activePointerId = null;
            divider.classList.remove('active');
            divider.classList.remove('hover');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        divider.addEventListener('pointerenter', (event) => {
            if (event.pointerType !== 'touch') {
                divider.classList.add('hover');
            }
        });

        divider.addEventListener('pointerleave', () => {
            if (!isDragging) {
                divider.classList.remove('hover');
            }
        });

        divider.addEventListener('pointerdown', (event) => {
            if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;

            isDragging = true;
            activePointerId = event.pointerId;
            const containerRect = container.getBoundingClientRect();
            dragPointerOffset = event.clientX
                - containerRect.left
                - leftPane.getBoundingClientRect().width;
            divider.classList.add('active');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            divider.setPointerCapture?.(event.pointerId);
            event.preventDefault();
        });

        divider.addEventListener('dblclick', () => {
            const { availableWidth } = getDividerMetrics();
            applyLeftWidth(availableWidth / 2);
        });

        divider.addEventListener('pointermove', (event) => {
            if (!isDragging || event.pointerId !== activePointerId) return;

            const { containerRect } = getDividerMetrics();
            applyLeftWidth(event.clientX - containerRect.left - dragPointerOffset);
            event.preventDefault();
        });

        divider.addEventListener('pointerup', (event) => {
            finishDragging(event.pointerId);
        });

        divider.addEventListener('pointercancel', (event) => {
            finishDragging(event.pointerId);
        });

        divider.addEventListener('lostpointercapture', () => {
            finishDragging();
        });

        divider.addEventListener('keydown', (event) => {
            const metrics = getDividerMetrics();
            if (metrics.availableWidth <= 0) return;

            const currentLeftWidth = leftPane.getBoundingClientRect().width;
            const keyboardStep = Math.max(10, metrics.availableWidth * keyboardStepRatio);
            let nextLeftWidth;

            switch (event.key) {
                case 'ArrowLeft':
                    nextLeftWidth = currentLeftWidth - keyboardStep;
                    break;
                case 'ArrowRight':
                    nextLeftWidth = currentLeftWidth + keyboardStep;
                    break;
                case 'Home':
                    nextLeftWidth = metrics.effectiveMinPaneWidth;
                    break;
                case 'End':
                    nextLeftWidth = metrics.availableWidth - metrics.effectiveMinPaneWidth;
                    break;
                default:
                    return;
            }

            event.preventDefault();
            applyLeftWidth(nextLeftWidth);
        });

        window.addEventListener('resize', () => {
            const { availableWidth } = getDividerMetrics();
            applyLeftWidth(availableWidth * lastLeftRatio, false);
        });
    };

    // ----- entry point -----
    let lastContent = loadLastContent();
    let editor = setupEditor();
    if (typeof lastContent === 'string') {
        presetValue(lastContent);
    } else {
        presetValue(defaultInput);
    }
    setupOpenButton();
    setupResetButton();
    setupCopyButton(editor);
    setupExportButton();

    let scrollBarSettings = loadScrollBarSettings() || false;
    initScrollBarSync(scrollBarSettings);

    // initialize theme (dark/light)
    let themeSettings = loadThemeSettings();
    // normalize to boolean (Storehouse may return string or boolean)
    if (themeSettings === 'true' || themeSettings === true) {
        themeSettings = true;
    } else {
        themeSettings = false;
    }
    initThemeToggle(themeSettings);

    setupDivider();
};

window.addEventListener("load", () => {
    init();
});
