"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { notifyRequestError } from "@/shared/lib/notify";
import { listSessions, type Session } from "./client";

export function useSessionDirectory(
  allowed: boolean,
  employeeId: string,
  archiveOnly = false,
) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [search, setSearch] = useState("");
  const archived = archiveOnly;
  const [searchIn, setSearchIn] = useState<"all" | "title" | "content">("all");
  const [query, setQuery] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const loaded = useRef(false);
  const activeRefresh = useRef<{
    controller: AbortController;
    promise: Promise<void>;
  } | null>(null);
  const latest = useRef({
    employee_id: employeeId,
    search: query,
    search_in: searchIn,
    archived,
  });
  const generation = useRef(0);
  const paging = useRef(false);
  const pagesLoaded = useRef(1);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const refreshDirectory = useCallback(
    (options?: { background?: boolean }): Promise<void> => {
      // Polling joins the current request instead of invalidating its result every two seconds.
      if (options?.background && activeRefresh.current)
        return activeRefresh.current.promise;
      activeRefresh.current?.controller.abort();
      const controller = new AbortController();
      const version = ++generation.current;
      setLoading(!loaded.current);
      setRefreshing(loaded.current);
      setLoadError(false);
      const timeout = window.setTimeout(
        () => controller.abort(new Error("会话列表请求超时")),
        15000,
      );
      const promise = (async () => {
        try {
          const filter = { ...latest.current };
          let cursor: string | undefined;
          const items: Session[] = [];
          for (let page = 0; page < pagesLoaded.current; page++) {
            const result = await listSessions(controller.signal, {
              ...filter,
              cursor,
            });
            if (generation.current !== version) return;
            items.push(
              ...result.items.filter(
                (item) => !items.some((old) => old.id === item.id),
              ),
            );
            cursor = result.next_cursor ?? undefined;
            if (!cursor) break;
          }
          if (generation.current === version) {
            loaded.current = true;
            setSessions(items);
            setNextCursor(cursor ?? null);
          }
        } catch (reason) {
          if (generation.current !== version) return;
          setLoadError(true);
          throw reason;
        } finally {
          window.clearTimeout(timeout);
          if (generation.current === version) {
            activeRefresh.current = null;
            setLoading(false);
            setRefreshing(false);
          }
        }
      })();
      activeRefresh.current = { controller, promise };
      return promise;
    },
    [],
  );
  const invalidate = useCallback(() => {
    generation.current++;
    activeRefresh.current?.controller.abort();
    activeRefresh.current = null;
  }, []);
  useEffect(() => {
    let cancelled = false;
    latest.current = {
      employee_id: employeeId,
      search: query,
      search_in: searchIn,
      archived,
    };
    pagesLoaded.current = 1;
    void Promise.resolve()
      .then(() => {
        if (cancelled) return;
        loaded.current = false;
        setSessions([]);
        setNextCursor(null);
        setLoading(false);
        setRefreshing(false);
        setLoadError(false);
        if (allowed && (employeeId || archiveOnly)) return refreshDirectory();
      })
      .catch((reason) => {
        if (!cancelled) notifyRequestError(reason, "会话列表加载失败");
      });
    return () => {
      cancelled = true;
      invalidate();
    };
  }, [
    allowed,
    employeeId,
    query,
    searchIn,
    archived,
    archiveOnly,
    refreshDirectory,
    invalidate,
  ]);
  async function loadMoreSessions() {
    if (!nextCursor || loading || activeRefresh.current || paging.current)
      return;
    const version = generation.current;
    paging.current = true;
    setLoadingMore(true);
    try {
      const result = await listSessions(undefined, {
        ...latest.current,
        cursor: nextCursor,
      });
      if (generation.current === version) {
        pagesLoaded.current++;
        setSessions((items) => [
          ...items,
          ...result.items.filter(
            (item) => !items.some((old) => old.id === item.id),
          ),
        ]);
        setNextCursor(result.next_cursor ?? null);
      }
    } catch (reason) {
      notifyRequestError(reason, "加载更多会话失败");
    } finally {
      paging.current = false;
      setLoadingMore(false);
    }
  }
  return {
    sessions,
    updateSessions: setSessions,
    search,
    setSearch,
    archived,
    searchIn,
    setSearchIn,
    refreshDirectory,
    loadingSessions: loading,
    refreshingSessions: refreshing,
    sessionDirectoryError: loadError,
    loadingMoreSessions: loadingMore,
    hasMoreSessions: Boolean(nextCursor),
    loadMoreSessions,
  };
}
