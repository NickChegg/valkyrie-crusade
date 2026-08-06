import { getContext } from "../../../extensions.js";
import { eventSource } from "../../../../script.js";

let gameWindow = null;
const STATE_KEY = "valkyrieSaveState"; // A dedicated save key so it doesn't overlap with other games

function createUI() {
    // 1. Create a simplified, single-button UI drawer for Valkyrie Crusade
    const html = `
        <div class="extension-settings" id="vc-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>🏰 Valkyrie Crusade</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content" style="padding: 10px;">
                    <div style="display: flex; gap: 5px;">
                        <button id="vc-menu-open-btn" class="menu_button" style="margin: 0; flex-grow: 1; background: #4CAF50; color: white;">Play Game</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    $("#extensions_settings").append(html);

    // 2. Open the game instantly when clicked
    $("#vc-menu-open-btn").on("click", () => {
        // Dynamically calculates the exact URL based on where this index.js is located
        const gameUrl = new URL('game/index.html', import.meta.url).href;
        
        if (gameWindow && !gameWindow.closed) {
            gameWindow.location.href = gameUrl;
            gameWindow.focus();
        } else {
            // Opens in a popup window exactly like the game-engine version
            gameWindow = window.open(gameUrl, "ValkyrieCrusade", "width=1200,height=800");
        }
    });
}

// RELAY MESSAGES FROM GAME -> SILLYTAVERN
window.addEventListener("message", async (event) => {
    if (!event.data) return;
    const context = getContext();
    
    // Support both GAME_READY and your custom UNITY_READY event
    if (event.data.type === "GAME_READY" || event.data.type === "UNITY_READY") {
        dispatchToGame("CHAT_OPENED"); 
    } 
    // Support both USER_MESSAGE and your custom SEND_MESSAGE event
    else if (event.data.type === "USER_MESSAGE" || event.data.type === "SEND_MESSAGE") {
        const textarea = document.getElementById("send_textarea");
        const sendBtn = document.getElementById("send_but");
        if (textarea && sendBtn) {
            textarea.value = event.data.text || event.data.message; 
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
    // ---------- BACKGROUND PROMPT LOGIC ----------
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
    // ---------- GAME STATE SAVING LOGIC ----------
    else if (event.data.type === "SAVE_GAME_STATE") {
        if (context.chatMetadata) {
            // Saves using our dedicated key
            context.chatMetadata[STATE_KEY] = event.data.state;
        }
    }
    // ---------- SYSTEM PROMPT / LOREBOOK / TOKEN CHECKING ----------
    // (Kept completely intact from your working script to ensure compatibility)
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
        }
        if (loreText) {
            context.setExtensionPrompt(loreId, loreText, 0, event.data.depth || 4, false, 0);
        } else {
            context.setExtensionPrompt(loreId, "", 0, 0, false, 0);
        }
    }
});

// RELAY MESSAGES FROM SILLYTAVERN -> GAME
function dispatchToGame(eventName) {
    if (!gameWindow || gameWindow.closed) return;
    const context = getContext();
    
    // Pulls the save using the dedicated Valkyrie key
    const savedState = context.chatMetadata ? context.chatMetadata[STATE_KEY] : null;

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

// BOOT UP LISTENERS
jQuery(async () => {
    createUI();
    eventSource.on('chat_opened', () => dispatchToGame("CHAT_OPENED"));
    eventSource.on('message_received', () => dispatchToGame("MESSAGE_RECEIVED"));
    eventSource.on('message_deleted', () => dispatchToGame("CHAT_REWOUND"));
    eventSource.on('chat_swiped', () => dispatchToGame("CHAT_REWOUND"));
    eventSource.on('message_updated', () => dispatchToGame("CHAT_REWOUND"));
    eventSource.on('generation_started', () => dispatchToGame("GENERATION_STARTED"));
});