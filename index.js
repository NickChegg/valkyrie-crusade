import { getContext } from "../../../extensions.js";
import { eventSource } from "../../../../script.js";

let gameWindow = null;
let savedFolders = JSON.parse(localStorage.getItem('gameEngineFolders')) || ['dungeon'];

function createUI() {
    const html = `
        <div class="extension-settings" id="game-engine-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>🎮 Game Engine</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content" style="padding: 10px;">
                    <div style="display: flex; gap: 5px; margin-bottom: 10px;">
                        <select id="game-dropdown-selector" class="text_pole" style="flex-grow: 1;"></select>
                        <button id="game-menu-open-btn" class="menu_button" style="margin: 0;">Open</button>
                        <button id="game-menu-remove-btn" class="menu_button" style="margin: 0;" title="Remove">❌</button>
                    </div>
                    <hr>
                    <div style="display: flex; gap: 5px;">
                        <input type="text" id="game-new-input" class="text_pole" placeholder="New game folder..." style="flex-grow: 1;">
                        <button id="game-add-btn" class="menu_button" style="margin: 0;">Add</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    $("#extensions_settings").append(html);
    updateDropdown();

    $("#game-menu-open-btn").on("click", () => {
        const folder = $("#game-dropdown-selector").val();
        if (!folder) return;
        
        const gameUrl = new URL(`games/${folder}/index.html`, import.meta.url).href;
        
        if (gameWindow && !gameWindow.closed) {
            gameWindow.location.href = gameUrl;
            gameWindow.focus();
        } else {
            gameWindow = window.open(gameUrl, "GameEngine", "width=1000,height=700");
        }
    });

    $("#game-menu-remove-btn").on("click", () => {
        const folder = $("#game-dropdown-selector").val();
        if (!folder) return;
        savedFolders = savedFolders.filter(f => f !== folder);
        localStorage.setItem('gameEngineFolders', JSON.stringify(savedFolders));
        updateDropdown();
        toastr.success(`Removed '${folder}'`);
    });

    $("#game-add-btn").on("click", async () => {
        const folder = $("#game-new-input").val().trim().replace(/ /g, '-').toLowerCase();
        if (!folder) return;
        if (savedFolders.includes(folder)) return toastr.info("Folder already exists!");

        const testUrl = new URL(`games/${folder}/index.html`, import.meta.url).href;
        try {
            const res = await fetch(testUrl, { method: 'HEAD' });
            if (!res.ok) return toastr.error(`Could not find index.html in 'games/${folder}'`);
        } catch (e) {
            return toastr.error(`Error accessing 'games/${folder}'`);
        }
        
        savedFolders.push(folder);
        localStorage.setItem('gameEngineFolders', JSON.stringify(savedFolders));
        $("#game-new-input").val("");
        updateDropdown();
        toastr.success(`Added '${folder}'`);
    });
}

function updateDropdown() {
    let options = savedFolders.length > 0 
        ? savedFolders.map(f => `<option value="${f}">${f}</option>`).join('') 
        : `<option value="">-- Empty --</option>`;
    $("#game-dropdown-selector").html(options);
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
            console.error("Game Engine: Background LLM Error:", error);
        }
    }
    // ---------- GAME STATE SAVING LOGIC ----------
    else if (event.data.type === "SAVE_GAME_STATE") {
        if (context.chatMetadata) {
            context.chatMetadata.gameEngineState = event.data.state;
            console.log("Game Engine: State securely saved to chat metadata.");
        }
    }
    // ---------- CAPABILITY 3: DYNAMIC SYSTEM PROMPT / AUTHOR'S NOTE ----------
    else if (event.data.type === "INJECT_SYSTEM_PROMPT") {
        const promptId = event.data.id || "game_engine_sys_default";
        
        if (event.data.active === false || !event.data.text) {
            // Remove prompt (Key, Text, Position, Depth, ScanForWI, Role)
            context.setExtensionPrompt(promptId, "", 0, 0, false, 0);
        } else {
            context.setExtensionPrompt(
                promptId, 
                event.data.text,
                0, // Position (0 = In_Prompt)
                event.data.depth || 0, // Depth
                false, 
                0 // 0 = System Role
            );
        }
    }
    // ---------- CAPABILITY 2: DYNAMIC LOREBOOK ACTIVATION ----------
    else if (event.data.type === "ACTIVATE_LOREBOOK_ENTRY") {
        const loreId = event.data.id || "game_engine_lore_default";
        
        if (event.data.active === false) {
            context.setExtensionPrompt(loreId, "", 0, 0, false, 0);
            return;
        }

        let loreText = event.data.text || "";
        
        // Safely use window.world_info array instead of risking static imports
        if (!loreText && event.data.keyword && window.world_info) {
            const entry = window.world_info.find(e => 
                (e.comment && e.comment.toLowerCase() === event.data.keyword.toLowerCase()) || 
                (e.key && e.key.includes(event.data.keyword))
            );
            if (entry) {
                loreText = entry.content;
            } else {
                console.warn(`Game Engine: Could not find ST Lorebook entry for keyword '${event.data.keyword}'`);
            }
        }

        if (loreText) {
            context.setExtensionPrompt(
                loreId, 
                loreText,
                0,
                event.data.depth || 4, // standard lore depth
                false,
                0 // System Role
            );
        } else {
            context.setExtensionPrompt(loreId, "", 0, 0, false, 0);
        }
    }
    // ---------- CAPABILITY 8: TOKEN CHECKING ----------
    else if (event.data.type === "CHECK_TOKEN_COUNT") {
        try {
            let count = 0;
            
            // Dynamic import ensures the extension boots perfectly even if the tokenizers path fails or is incorrect.
            try {
                const tokenModule = await import("../../../tokenizers.js");
                if (tokenModule && tokenModule.getTokenCountAsync) {
                    count = await tokenModule.getTokenCountAsync(event.data.text || "");
                } else if (tokenModule && tokenModule.getTokenCount) {
                    count = tokenModule.getTokenCount(event.data.text || "");
                }
            } catch (err) {
                console.warn("Game Engine: Could not dynamically import tokenizers, falling back to approximation", err);
                count = Math.ceil((event.data.text || "").length / 4); // Approximation fallback
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
            console.error("Game Engine: Token Count Error:", error);
        }
    }
});

// RELAY MESSAGES FROM SILLYTAVERN -> GAME
function dispatchToGame(eventName) {
    if (!gameWindow || gameWindow.closed) return;
    const context = getContext();
    
    // Grab the custom state from the chat file (if it exists)
    const savedState = context.chatMetadata ? context.chatMetadata.gameEngineState : null;

    gameWindow.postMessage({
        type: "ST_EVENT",
        event: eventName,
        chatId: context.chatId || "default",
        chat: context.chat || [],
        gameState: savedState, 
        // CAPABILITY 5: METADATA & INITIALIZATION VARIABLES
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