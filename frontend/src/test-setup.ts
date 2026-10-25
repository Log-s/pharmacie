import '@testing-library/jest-dom/vitest'

// ProseMirror (Tiptap) measures text through layout APIs that jsdom lacks.
const emptyRect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect
const noRects = () => Object.assign([], { item: () => null }) as unknown as DOMRectList
Range.prototype.getClientRects ??= noRects
Range.prototype.getBoundingClientRect ??= () => emptyRect
document.elementFromPoint ??= () => null
