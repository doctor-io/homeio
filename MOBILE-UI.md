# Homeio mobile UI

Use the Ionic web component patterns for structure and the Apple guidance for expected navigation. Apply those patterns with Homeio's colors, icons, and React components. [Ionic toolbar](https://ionicframework.com/docs/api/toolbar) · [Apple toolbars](https://developer.apple.com/design/human-interface-guidelines/toolbars)

| Pattern | Homeio convention |
| --- | --- |
| Tool screen | Use `Window` for the safe-area header, tool content, and its relationship with the Dock. Let the content fill the remaining space and let the relevant list, form, or editor handle scrolling. Keep the Dock in the side rail for short landscape tool screens. [Ionic content](https://ionicframework.com/docs/api/content) |
| Navigation | Use a single Back action in the toolbar. Register a child page with `useMobileWindowPage` when a folder, Store detail, or settings section has its own title and return action. Keep the tool mounted while another tab is visible. [Ionic tabs](https://ionicframework.com/docs/api/tabs) |
| Lists | Group related rows on `mobile-list-group` surfaces. Keep row labels readable, reserve trailing actions for useful controls, and separate groups with spacing. [Ionic list](https://ionicframework.com/docs/api/list) · [Ionic item](https://ionicframework.com/docs/api/item) |
| Forms and overlays | Use `DialogContent mobileSheet` for a task that can be completed within the current tool, such as adding a source or browsing storage. It presents as a sheet on a portrait phone and as a centered dialog in landscape. Use the regular centered alert for a short confirmation. [Ionic modal](https://ionicframework.com/docs/api/modal) · [Apple sheets](https://developer.apple.com/design/human-interface-guidelines/sheets) |
| Window activity | `DialogContent` and `AlertDialogContent` follow their window's visibility. Keep drafts in the tool or form controller so switching tabs hides the overlay and returning restores it. |

Check new screens with 320 px of width, a larger portrait viewport, and short landscape. Verify the safe areas, 44 px navigation targets, scroll reachability, and Back behavior from the deepest screen. Open the same screens in desktop mode and verify that multiple windows still work. [WebKit safe areas](https://webkit.org/blog/7929/designing-websites-for-iphone-x/)
