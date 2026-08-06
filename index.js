import { getContext } from "../../../extensions.js";
import { eventSource } from "../../../../script.js";

let gameWindow = null;

function createUI() {
    const html = `
        <div class="extension-settings" id="valkyrie-crusade-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>⚔️ Valkyrie Crusade</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content" style="padding: 10px;">
                    <p>Launch the Valkyrie Crusade kingdom builder.</p>
                    <button id="valkyrie-menu-open-btn" class="menu_button" style="margin: 0;">Play Game</button>
                </div>
            </div>
        </div>
    `;
    
    $("#extensions_settings").append(html);

    $("#valkyrie-menu-open-btn").on("click", () => {
        // Points directly to the "game" subfolder inside this extension
        const gameUrl = new URL(`game/index.html`, import.meta.url).href;
        
        if (gameWindow && !gameWindow.closed) {
            gameWindow.location.href = gameUrl;
            gameWindow.focus();
        } else {
            gameWindow = window.open(gameUrl, "ValkyrieCrusade", "width=1280,height=720");
        }
    });
}

// RELAY MESSAGES FROM GAME -> SILLYTAVERN
window.addEventListener("message", async (event) => {
    if (!event.data) return;
    const context = getContext();
    
    if (event.data.type === "GAME_READY") {
        dispatchToGame("CHAT_OPENED"); 
    } 
    else if (event.data.type === "USER_MESSAGE") {
        const textarea = document.getElementById("send_textarea");
        const sendBtn = document.getElementById("send_but");
        if (textarea && sendBtn) {
            textarea.value = event.data.text;
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
            sendBtn.click();
        }
    }
    else if (event.data.type === "SWIPE_MESSAGE") {
        const messages = document.querySelectorAll('.mes');
        if (messages.length > 0) {
            const lastMsg = messages[messages.length - 1];
            const btnClass = event.data.direction === 'left' ? '.swipe_left' : '.swipe_right';
            const swipeBtn = lastMsg.querySelector(btnClass);
            
            if (swipeBtn) {
                swipeBtn.click();
                setTimeout(() => dispatchToGame("CHAT_REWOUND"), 100);
                setTimeout(() => dispatchToGame("CHAT_REWOUND"), 500); 
            }
        }
    }
    else if (event.data.type === "REWRITE_MESSAGE") {
        const id = event.data.messageId;
        if (context.chat && context.chat[id]) {
            context.chat[id].mes = event.data.text;
            const msgEl = document.querySelector(`.mes[mesid="${id}"] .mes_text`);
            if (msgEl) {
                msgEl.innerHTML = event.data.text.replace(/\n/g, '<br>');
            }
        }
    }
    else if (event.data.type === "BACKGROUND_PROMPT") {
        try {
            let resultText = "";
            if (event.data.useContext) {
                resultText = await context.generateQuietPrompt(event.data.prompt);
            } else {
                resultText = await context.generateRaw(event.data.prompt);
            }
            
            if (gameWindow && !gameWindow.closed) {
                gameWindow.postMessage({
                    type: "ST_EVENT",
                    event: "BACKGROUND_RESPONSE",
                    taskId: event.data.taskId || "default",
                    result: resultText
                }, "*");
            }
        } catch (error) {
            console.error("Valkyrie Crusade: Background LLM Error:", error);
        }
    }
    else if (event.data.type === "SAVE_GAME_STATE") {
        if (context.chatMetadata) {
            context.chatMetadata.valkyrieCrusadeState = event.data.state;
            console.log("Valkyrie Crusade: State securely saved to chat metadata.");
        }
    }
    else if (event.data.type === "INJECT_SYSTEM_PROMPT") {
        const promptId = event.data.id || "vc_sys_default";
        
        if (event.data.active === false || !event.data.text) {
            context.setExtensionPrompt(promptId, "", 0, 0, false, 0);
        } else {
            context.setExtensionPrompt(promptId, event.data.text, 0, event.data.depth || 0, false, 0);
        }
    }
    else if (event.data.type === "ACTIVATE_LOREBOOK_ENTRY") {
        const loreId = event.data.id || "vc_lore_default";
        
        if (event.data.active === false) {
            context.setExtensionPrompt(loreId, "", 0, 0, false, 0);
            return;
        }

        let loreText = event.data.text || "";
        
        if (!loreText && event.data.keyword && window.world_info) {
            const entry = window.world_info.find(e => 
                (e.comment && e.comment.toLowerCase() === event.data.keyword.toLowerCase()) || 
                (e.key && e.key.includes(event.data.keyword))
            );
            if (entry) loreText = entry.content;
            else console.warn(`Valkyrie Crusade: Could not find ST Lorebook entry for keyword '${event.data.keyword}'`);
        }

        if (loreText) {
            context.setExtensionPrompt(loreId, loreText, 0, event.data.depth || 4, false, 0);
        } else {
            context.setExtensionPrompt(loreId, "", 0, 0, false, 0);
        }
    }
    else if (event.data.type === "CHECK_TOKEN_COUNT") {
        try {
            let count = 0;
            try {
                const tokenModule = await import("../../../tokenizers.js");
                if (tokenModule && tokenModule.getTokenCountAsync) count = await tokenModule.getTokenCountAsync(event.data.text || "");
                else if (tokenModule && tokenModule.getTokenCount) count = tokenModule.getTokenCount(event.data.text || "");
            } catch (err) {
                count = Math.ceil((event.data.text || "").length / 4);
            }

            if (gameWindow && !gameWindow.closed) {
                gameWindow.postMessage({
                    type: "ST_EVENT",
                    event: "TOKEN_COUNT_RESULT",
                    taskId: event.data.taskId || "default",
                    count: count
                }, "*");
            }
        } catch (error) {
            console.error("Valkyrie Crusade: Token Count Error:", error);
        }
    }
});

// RELAY MESSAGES FROM SILLYTAVERN -> GAME
function dispatchToGame(eventName) {
    if (!gameWindow || gameWindow.closed) return;
    const context = getContext();
    
    // Support migrating old 'gameEngineState' save data to 'valkyrieCrusadeState'
    let savedState = null;
    if (context.chatMetadata) {
        savedState = context.chatMetadata.valkyrieCrusadeState || context.chatMetadata.gameEngineState;
    }

    gameWindow.postMessage({
        type: "ST_EVENT",
        event: eventName,
        chatId: context.chatId || "default",
        chat: context.chat || [],
        gameState: savedState, 
        characterName: context.name2 || (context.characters?.[context.characterId]?.name) || "Character",
        userName: context.name1 || "User",
        userAvatar: context.avatar1 || null,
        characterAvatar: context.characters?.[context.characterId]?.avatar || null
    }, "*");
}

jQuery(async () => {
    createUI();
    eventSource.on('chat_opened', () => dispatchToGame("CHAT_OPENED"));
    eventSource.on('message_received', () => dispatchToGame("MESSAGE_RECEIVED"));
    eventSource.on('message_deleted', () => dispatchToGame("CHAT_REWOUND"));
    eventSource.on('chat_swiped', () => dispatchToGame("CHAT_REWOUND"));
    eventSource.on('message_updated', () => dispatchToGame("CHAT_REWOUND"));
    eventSource.on('generation_started', () => dispatchToGame("GENERATION_STARTED"));
});