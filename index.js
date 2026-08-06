import { getContext } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../script.js";

// Ensure this exactly matches the name of your folder in third-party/extensions/
const extensionName = "Valkyrie-Crusade"; 

// Using lowercase 'third-party/extensions' as that is how SillyTavern's web server routes it
const gamePath = `/third-party/extensions/${extensionName}/game/index.html`;

let gameIframe = null;
let gameContainer = null;

// Mount the game fullscreen over SillyTavern
function bootGame() {
    if (gameContainer) return;

    // Create a container to hold the game and the close button
    gameContainer = document.createElement("div");
    gameContainer.style.cssText = "position:fixed; top:0; left:0; width:100vw; height:100vh; z-index:9999; background:black;";

    // Create the game iframe
    gameIframe = document.createElement("iframe");
    gameIframe.src = gamePath;
    gameIframe.style.cssText = "width:100%; height:100%; border:none;";

    // Create a Close Button
    const closeBtn = document.createElement("button");
    closeBtn.innerText = "✖ Close Valkyrie Crusade";
    closeBtn.style.cssText = "position:absolute; top:20px; right:20px; z-index:10000; padding:10px 15px; background:#ff4444; color:white; border:none; border-radius:5px; font-weight:bold; cursor:pointer;";
    closeBtn.onclick = () => {
        document.body.removeChild(gameContainer);
        gameContainer = null;
        gameIframe = null;
    };

    gameContainer.appendChild(gameIframe);
    gameContainer.appendChild(closeBtn);
    document.body.appendChild(gameContainer);
}

jQuery(async () => {
    // 1. Add the "Boot Game" button to the extensions menu
    const buttonHtml = `
        <div class="list-group-item">
            <div class="m-b-1 flex-container justify-space-between align-items-center">
                <span style="font-weight:bold; font-size:1.1em;">🏰 Valkyrie Crusade</span>
                <div class="menu_button" id="vc-boot-btn" style="background:#4CAF50; color:white;">Play Game</div>
            </div>
        </div>
    `;
    $("#extensions_settings").append(buttonHtml);
    $("#vc-boot-btn").on("click", bootGame);

    // 2. Listen for messages flowing between Unity and SillyTavern
    window.addEventListener("message", (event) => {
        const data = event.data;
        if (!data) return;

        // When Unity finishes loading, push the current chat and save data into it
        if (data.type === 'UNITY_READY') {
            const context = getContext();
            const savedState = (context.chatMetadata && context.chatMetadata.valkyrieSaveState) 
                                ? context.chatMetadata.valkyrieSaveState 
                                : null;

            gameIframe.contentWindow.postMessage({
                type: 'ST_EVENT',
                event: 'CHAT_OPENED',
                gameState: savedState,
                chat: context.chat || []
            }, '*');
        }

        // Handle SAVE data coming from Unity's .jslib
        if (data.type === 'SAVE_GAME_STATE') {
            const context = getContext();
            if (!context.chatMetadata) context.chatMetadata = {};
            context.chatMetadata.valkyrieSaveState = JSON.parse(data.state);
            
            saveSettingsDebounced(); // Trigger ST to save to disk
        }

        // Handle LLM Messages coming from Unity's .jslib
        if (data.type === 'SEND_MESSAGE') {
            const textarea = document.getElementById('send_textarea');
            const sendBtn = document.getElementById('send_but');
            
            if (textarea && sendBtn) {
                textarea.value = data.message;
                
                // Tell SillyTavern the text changed so it registers the input
                textarea.dispatchEvent(new Event('input', { bubbles: true })); 
                
                // Click the send button!
                sendBtn.click(); 
            }
        }
    });
});