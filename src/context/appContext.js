import { createContext, useContext } from "react";

const AppContext = createContext(null);

export const AppContextProvider = AppContext.Provider;

/**
 * 全局下发：config、books、reloadBooks、setError。
 * 路由状态（route/bookId）由 useRoute() 直接订阅，导航用 router.js 的 navigate，
 * 任务通道与页面专属回调不走 Context，仍经 props 传递。
 */
export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) throw new Error("useAppContext 必须在 AppContextProvider 内使用");
  return context;
}
