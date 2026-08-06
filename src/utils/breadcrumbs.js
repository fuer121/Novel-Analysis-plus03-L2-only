import { paths } from "../router.js";

/** 由路由状态推导面包屑段（工作台 › 书名 › 页面）。bookName 缺省时回退 bookId。 */
export function breadcrumbParts({ route, bookId, bookName }) {
  const workbench = { label: "工作台", path: paths.workbench() };
  switch (route) {
    case "workbench":
      return [{ label: "工作台" }];
    case "diagnostics":
      return [workbench, { label: "诊断" }];
    case "book":
      return [workbench, { label: bookName || bookId }];
    case "l1":
      return [workbench, { label: bookName || bookId, path: paths.book(bookId) }, { label: "章节线索", badge: "L1" }];
    case "l2":
      return [workbench, { label: bookName || bookId, path: paths.book(bookId) }, { label: "事实索引", badge: "L2" }];
    case "ask":
      return [workbench, { label: bookName || bookId, path: paths.book(bookId) }, { label: "提问管理" }];
    default:
      return [{ label: "工作台" }];
  }
}
