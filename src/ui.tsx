import { render } from "@create-figma-plugin/ui";
import { emit, on } from "@create-figma-plugin/utilities";
import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "preact";

import type { ChatMessage, PluginUIProps, SDK } from "./types";
import styles from "./ui.css";

const EVENT_SUBMIT_QUERY = "SUBMIT_QUERY";
const EVENT_SDK_CHANGED = "SDK_CHANGED";
const EVENT_RESPONSE = "CODEX_RESPONSE";
const EVENT_ERROR = "PLUGIN_ERROR";
const STORAGE_KEY = "codex-design-chat.sdk";

function Plugin({ initialSdk }: PluginUIProps) {
    const [messages, setMessages] = useState<Array<ChatMessage>>([]);
    const [inputValue, setInputValue] = useState("");
    const [sdk, setSdk] = useState<SDK>(initialSdk);
    const [isSending, setIsSending] = useState(false);
    const [status, setStatus] = useState("");
    const messagesRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        const saved = readSdkFromStorage();
        if (saved && saved !== initialSdk) {
            setSdk(saved);
            emit(EVENT_SDK_CHANGED, { sdk: saved });
        }
    }, []);

    useEffect(() => {
        const disposeResponse = on(
            EVENT_RESPONSE,
            function ({ text }: { text: string }) {
                setMessages((prev) => [
                    ...prev,
                    { role: "assistant", content: text },
                ]);
                setIsSending(false);
                setStatus("");
            }
        );

        const disposeError = on(
            EVENT_ERROR,
            function ({ message }: { message: string }) {
                setMessages((prev) => [
                    ...prev,
                    { role: "assistant", content: message },
                ]);
                setIsSending(false);
                setStatus("");
            }
        );

        return () => {
            disposeResponse();
            disposeError();
        };
    }, []);

    useEffect(() => {
        const container = messagesRef.current;
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }, [messages]);

    const chatTitle = useMemo(
        () => (sdk === "claude" ? "Claude Design Chat" : "Codex Design Chat"),
        [sdk]
    );
    const placeholder = useMemo(
        () =>
            sdk === "claude"
                ? "Claudeに相談する内容を入力..."
                : "Codexに相談する内容を入力...",
        [sdk]
    );

    function handleSdkChange(event: JSX.TargetedEvent<HTMLSelectElement>) {
        const target = event.currentTarget;
        const nextSdk = target.value as SDK;
        setSdk(nextSdk);
        persistSdk(nextSdk);
        emit(EVENT_SDK_CHANGED, { sdk: nextSdk });
    }

    function handleInputChange(event: JSX.TargetedEvent<HTMLInputElement>) {
        const target = event.currentTarget;
        setInputValue(target.value);
    }

    function handleSubmit(event: JSX.TargetedEvent<HTMLFormElement>) {
        event.preventDefault();
        const trimmed = inputValue.trim();
        if (!trimmed || isSending) return;

        const userMessage: ChatMessage = { role: "user", content: trimmed };
        setMessages((prev) => {
            const nextHistory = [...prev, userMessage];
            emit(EVENT_SUBMIT_QUERY, {
                text: trimmed,
                history: nextHistory,
                sdk,
            });
            return nextHistory;
        });
        setInputValue("");
        setIsSending(true);
        setStatus(`${sdk === "claude" ? "Claude" : "Codex"}に問い合わせ中...`);
    }

    return (
        <div class={styles.root}>
            <div class={styles.header}>
                <div class={styles.title}>{chatTitle}</div>
                <div class={styles.subtitle}>
                    Figmaのレイヤー情報を踏まえて相談できます。
                </div>
                <div class={styles.sdkSelectorContainer}>
                    <label class={styles.sdkLabel} htmlFor="sdk-selector">
                        AI Model:
                    </label>
                    <select
                        id="sdk-selector"
                        class={styles.sdkSelector}
                        value={sdk}
                        onChange={handleSdkChange}
                        disabled={isSending}
                    >
                        <option value="codex">Codex</option>
                        <option value="claude">Claude</option>
                    </select>
                </div>
            </div>

            <div class={styles.messages} ref={messagesRef}>
                {messages.map((message, index) => (
                    <div
                        key={`${message.role}-${index}`}
                        class={`${styles.bubble} ${
                            message.role === "user"
                                ? styles.user
                                : styles.assistant
                        }`}
                    >
                        {message.content}
                    </div>
                ))}
            </div>

            <div class={styles.status}>{status}</div>

            <form class={styles.form} onSubmit={handleSubmit}>
                <input
                    class={styles.input}
                    type="text"
                    value={inputValue}
                    onInput={handleInputChange}
                    placeholder={placeholder}
                    autoComplete="off"
                    disabled={isSending}
                />
                <button
                    class={styles.button}
                    type="submit"
                    disabled={isSending || inputValue.trim().length === 0}
                >
                    送信
                </button>
            </form>
        </div>
    );
}

function persistSdk(value: SDK) {
    try {
        localStorage.setItem(STORAGE_KEY, value);
    } catch (error) {
        console.warn("Failed to persist SDK selection", error);
    }
}

function readSdkFromStorage(): SDK | null {
    try {
        const value = localStorage.getItem(STORAGE_KEY);
        if (value === "codex" || value === "claude") {
            return value;
        }
        return null;
    } catch (error) {
        return null;
    }
}

export default render(Plugin);
