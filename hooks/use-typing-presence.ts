"use client";

import { useConvex, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const HEARTBEAT_INTERVAL_MS = 1_500;
const TYPING_IDLE_MS = 1_250;

type VisitorScope = {
  kind: "visitor";
  workspaceId: Id<"workspaces">;
  token: string;
};

type OwnerScope = {
  kind: "owner";
  conversationId: Id<"conversations">;
};

export type TypingPresenceScope = VisitorScope | OwnerScope;

const typingPresenceApi = api.typingPresence;

function sameScope(
  left: TypingPresenceScope | null,
  right: TypingPresenceScope | null,
) {
  if (!left || !right || left.kind !== right.kind) return left === right;
  if (left.kind === "visitor" && right.kind === "visitor") {
    return (
      left.workspaceId === right.workspaceId && left.token === right.token
    );
  }
  return (
    left.kind === "owner" &&
    right.kind === "owner" &&
    left.conversationId === right.conversationId
  );
}

export function useTypingPresence({
  enabled,
  scope,
}: {
  enabled: boolean;
  scope: TypingPresenceScope | null;
}) {
  const convex = useConvex();
  const [sessionId] = useState(() => crypto.randomUUID());
  const [roomAccess, setRoomAccess] = useState<{
    roomToken: string;
    scope: TypingPresenceScope;
  } | null>(null);

  const heartbeatVisitor = useMutation(typingPresenceApi.heartbeatVisitor);
  const heartbeatOwner = useMutation(typingPresenceApi.heartbeatOwner);
  const setVisitorTyping = useMutation(typingPresenceApi.setVisitorTyping);
  const setOwnerTyping = useMutation(typingPresenceApi.setOwnerTyping);
  const disconnect = useMutation(typingPresenceApi.disconnect);

  const activeScopeRef = useRef<TypingPresenceScope | null>(null);
  const sessionTokenRef = useRef<string | null>(null);
  const sessionScopeRef = useRef<TypingPresenceScope | null>(null);
  const heartbeatInFlightRef = useRef(false);
  const heartbeatQueuedRef = useRef(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingActiveRef = useRef(false);
  const typingReadyRef = useRef(false);
  const pendingTypingStartRef = useRef(false);

  const visitorWorkspaceId = scope?.kind === "visitor" ? scope.workspaceId : null;
  const visitorToken = scope?.kind === "visitor" ? scope.token : null;
  const ownerConversationId =
    scope?.kind === "owner" ? scope.conversationId : null;

  const publishTyping = useCallback(
    (target: TypingPresenceScope, typing: boolean) => {
      if (target.kind === "visitor") {
        void setVisitorTyping({
          workspaceId: target.workspaceId,
          token: target.token,
          sessionId,
          typing,
        }).catch(() => undefined);
        return;
      }
      void setOwnerTyping({
        conversationId: target.conversationId,
        sessionId,
        typing,
      }).catch(() => undefined);
    },
    [sessionId, setOwnerTyping, setVisitorTyping],
  );

  const clearTyping = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    const target = activeScopeRef.current;
    const wasTyping = typingActiveRef.current;
    typingActiveRef.current = false;
    pendingTypingStartRef.current = false;
    if (target && wasTyping) publishTyping(target, false);
  }, [publishTyping]);

  const disconnectSession = useCallback(() => {
    const token = sessionTokenRef.current;
    sessionTokenRef.current = null;
    sessionScopeRef.current = null;
    typingReadyRef.current = false;
    setRoomAccess(null);
    if (token) {
      void disconnect({ sessionToken: token }).catch(() => undefined);
    }
  }, [disconnect]);

  const heartbeat = useCallback(async () => {
    if (heartbeatInFlightRef.current) {
      heartbeatQueuedRef.current = true;
      return;
    }

    heartbeatInFlightRef.current = true;
    try {
      do {
        heartbeatQueuedRef.current = false;
        const target = activeScopeRef.current;
        if (!target || document.hidden) break;
        try {
          const result =
            target.kind === "visitor"
              ? await heartbeatVisitor({
                  workspaceId: target.workspaceId,
                  token: target.token,
                  sessionId,
                })
              : await heartbeatOwner({
                  conversationId: target.conversationId,
                  sessionId,
                });

          if (!result) continue;
          if (
            activeScopeRef.current &&
            sameScope(activeScopeRef.current, target) &&
            !document.hidden
          ) {
            const freshSession =
              !typingReadyRef.current ||
              !sameScope(sessionScopeRef.current, target) ||
              sessionTokenRef.current !== result.sessionToken;
            if (freshSession) {
              try {
                if (target.kind === "visitor") {
                  await setVisitorTyping({
                    workspaceId: target.workspaceId,
                    token: target.token,
                    sessionId,
                    typing: false,
                  });
                } else {
                  await setOwnerTyping({
                    conversationId: target.conversationId,
                    sessionId,
                    typing: false,
                  });
                }
              } catch {
                void disconnect({ sessionToken: result.sessionToken }).catch(
                  () => undefined,
                );
                continue;
              }
            }
            if (
              !activeScopeRef.current ||
              !sameScope(activeScopeRef.current, target) ||
              document.hidden
            ) {
              void disconnect({ sessionToken: result.sessionToken }).catch(
                () => undefined,
              );
              continue;
            }
            sessionTokenRef.current = result.sessionToken;
            sessionScopeRef.current = target;
            typingReadyRef.current = true;
            setRoomAccess({ roomToken: result.roomToken, scope: target });
            if (pendingTypingStartRef.current && !typingActiveRef.current) {
              pendingTypingStartRef.current = false;
              typingActiveRef.current = true;
              publishTyping(target, true);
            }
          } else {
            void disconnect({ sessionToken: result.sessionToken }).catch(
              () => undefined,
            );
          }
        } catch {
          // Presence is ephemeral and must not interfere with messaging.
        }
      } while (heartbeatQueuedRef.current);
    } finally {
      heartbeatInFlightRef.current = false;
    }
  }, [
    disconnect,
    heartbeatOwner,
    heartbeatVisitor,
    publishTyping,
    sessionId,
    setOwnerTyping,
    setVisitorTyping,
  ]);

  useEffect(() => {
    const target: TypingPresenceScope | null =
      enabled && visitorWorkspaceId && visitorToken
        ? {
            kind: "visitor",
            workspaceId: visitorWorkspaceId,
            token: visitorToken,
          }
        : enabled && ownerConversationId
          ? { kind: "owner", conversationId: ownerConversationId }
          : null;
    if (!target) {
      activeScopeRef.current = null;
      return;
    }

    let interval: ReturnType<typeof setInterval> | null = null;
    activeScopeRef.current = target;
    typingReadyRef.current = false;

    const stopHeartbeat = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };
    const startHeartbeat = () => {
      stopHeartbeat();
      void heartbeat();
      interval = setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);
    };
    const leave = () => {
      stopHeartbeat();
      clearTyping();
      if (sameScope(activeScopeRef.current, target)) {
        activeScopeRef.current = null;
      }
      disconnectSession();
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        leave();
      } else {
        activeScopeRef.current = target;
        startHeartbeat();
      }
    };
    const onBeforeUnload = () => {
      const token = sessionTokenRef.current;
      if (!token || !sameScope(sessionScopeRef.current, target)) return;
      const body = new Blob(
        [
          JSON.stringify({
            path: "typingPresence:disconnect",
            args: { sessionToken: token },
          }),
        ],
        { type: "application/json" },
      );
      navigator.sendBeacon(`${convex.url}/api/mutation`, body);
    };

    if (!document.hidden) startHeartbeat();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("beforeunload", onBeforeUnload);
      leave();
    };
  }, [
    clearTyping,
    convex.url,
    disconnectSession,
    enabled,
    heartbeat,
    ownerConversationId,
    visitorToken,
    visitorWorkspaceId,
  ]);

  const updateTyping = useCallback(
    (value: string) => {
      const target = activeScopeRef.current;
      if (!target || !value.trim()) {
        clearTyping();
        return;
      }

      if (!typingReadyRef.current) {
        pendingTypingStartRef.current = true;
      } else if (!typingActiveRef.current) {
        typingActiveRef.current = true;
        publishTyping(target, true);
      }
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        idleTimerRef.current = null;
        const currentTarget = activeScopeRef.current;
        pendingTypingStartRef.current = false;
        if (!typingActiveRef.current || !currentTarget) return;
        typingActiveRef.current = false;
        publishTyping(currentTarget, false);
      }, TYPING_IDLE_MS);
    },
    [clearTyping, publishTyping],
  );

  const visitorState = useQuery(
    typingPresenceApi.listForVisitor,
    enabled &&
      scope?.kind === "visitor" &&
      roomAccess &&
      sameScope(roomAccess.scope, scope)
      ? {
          workspaceId: scope.workspaceId,
          token: scope.token,
          roomToken: roomAccess.roomToken,
        }
      : "skip",
  );
  const ownerState = useQuery(
    typingPresenceApi.listForOwner,
    enabled &&
      scope?.kind === "owner" &&
      roomAccess &&
      sameScope(roomAccess.scope, scope)
      ? { conversationId: scope.conversationId, roomToken: roomAccess.roomToken }
      : "skip",
  );
  const state = scope?.kind === "visitor" ? visitorState : ownerState;

  return {
    visitorTyping: enabled ? (state?.visitorTyping ?? false) : false,
    ownerTyping: enabled ? (state?.ownerTyping ?? false) : false,
    ownerDisplayName: enabled ? (state?.ownerDisplayName ?? null) : null,
    updateTyping,
    clearTyping,
  };
}
