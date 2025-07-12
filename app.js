// Freesound API client ID - Replace with your own client ID from https://freesound.org/apiv2/apply/
const FREESOUND_API_KEY = '	ZarUHi3332A1iIxq4elJuHygvVrGB1xODuChRR5G';

// Local sound mappings for fallback
const LOCAL_SOUNDS = {
    
};

// Available voices cache
let availableVoices = [];

// DOM Elements
const micButton = document.getElementById('micButton');
const ttsButton = document.getElementById('ttsButton');
const timelineButton = document.getElementById('timelineButton');
const status = document.getElementById('status');
const transcription = document.getElementById('transcription');
const soundResults = document.getElementById('soundResults');
const libraryContent = document.getElementById('libraryContent');
const timeline = document.getElementById('timeline');
const playButton = document.getElementById('playButton');
const stopButton = document.getElementById('stopButton');
const saveButton = document.getElementById('saveButton');
const exportButton = document.getElementById('exportButton');
const addTrackButton = document.getElementById('addTrackButton');
const timeDisplay = document.querySelector('.time-display');

// Speech Recognition Setup
let recognition = null;
let isListening = false;
let currentAudio = null;
let currentSearchResults = [];
let currentSoundIndex = -1;
let permissionGranted = false;
let isTTSMode = false;

// Tone configurations
const TONES = {
    'happy': { pitch: 1.2, rate: 1.1 },
    'sad': { pitch: 0.8, rate: 0.9 },
    'excited': { pitch: 1.3, rate: 1.2 },
    'angry': { pitch: 1.2, rate: 1.3 },
    'calm': { pitch: 1.0, rate: 0.9 },
    'whisper': { pitch: 0.9, rate: 0.8, volume: 0.6 },
    'robot': { pitch: 0.5, rate: 1.0 },
    'fast': { pitch: 1.0, rate: 1.5 },
    'slow': { pitch: 1.0, rate: 0.7 },
    'child': { pitch: 1.5, rate: 1.1 },
    'elder': { pitch: 0.8, rate: 0.8 },
    'normal': { pitch: 1.0, rate: 1.0 }
};

// State tracking for TTS conversation
let ttsState = {
    text: null,
    waitingForPreferences: false,
    currentAccent: null,
    currentTone: null
};

// Mode tracking
let currentMode = 'none'; // 'sfx', 'dialogue', 'timeline'

// Library storage
let soundLibrary = {
    sfx: [], // {id, name, url, duration}
    dialogue: [] // {id, text, accent, tone, audio}
};

// Timeline data
let timelineTracks = [];
let isPlaying = false;
let currentTime = 0;
let playbackInterval = null;

// Current playback tracking
let lastPlayedSound = null;

// Timeline voice commands
const TIMELINE_COMMANDS = {
    ADD: ['add', 'insert', 'place'],
    MOVE: ['move', 'shift', 'reposition'],
    DELETE: ['delete', 'remove', 'clear'],
    PLAY: ['play', 'start', 'begin'],
    STOP: ['stop', 'pause', 'end'],
    TRACK: ['track', 'layer', 'channel']
};

// Audio context for timeline playback
let audioContext = null;

// Audio recording setup for TTS
let mediaRecorder = null;
let audioChunks = [];

// Add these variables after the soundLibrary declaration
let nextSoundNumber = 1;
let nextDialogueLetter = 'A';

function initializeAudioContext() {
    if (!audioContext || audioContext.state === 'closed') {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Resume the audio context if it's suspended (browser autoplay policy)
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
}

// Initialize voices
function initializeVoices() {
    // Get the available voices
    availableVoices = window.speechSynthesis.getVoices();
    
    // If voices aren't loaded yet, wait for them
    if (availableVoices.length === 0) {
        window.speechSynthesis.onvoiceschanged = () => {
            availableVoices = window.speechSynthesis.getVoices();
        };
    }
}

// Initialize voices on page load
initializeVoices();

// Function to find the best matching voice for a given accent
function findVoiceForAccent(accent) {
    accent = accent.toLowerCase();
    
    // Map common accent names to language codes
    const accentMap = {
        'german': 'de-DE',
        'french': 'fr-FR',
        'british': 'en-GB',
        'american': 'en-US',
        'australian': 'en-AU',
        'indian': 'en-IN',
        'spanish': 'es-ES',
        'italian': 'it-IT',
        'japanese': 'ja-JP',
        'chinese': 'zh-CN',
        'russian': 'ru-RU'
    };

    const languageCode = accentMap[accent] || accent;
    
    // Try to find an exact match first
    let voice = availableVoices.find(v => v.lang.toLowerCase().includes(languageCode.toLowerCase()));
    
    // If no exact match, try to find any voice that includes the accent name
    if (!voice) {
        voice = availableVoices.find(v => 
            v.name.toLowerCase().includes(accent) || 
            v.lang.toLowerCase().includes(accent)
        );
    }
    
    // Default to the first available voice if no match found
    return voice || availableVoices[0];
}

function initializeSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    
    // Speech Recognition Events
    recognition.onstart = () => {
        isListening = true;
        const activeButton = isTTSMode ? ttsButton : micButton;
        activeButton.classList.add('recording');
        status.textContent = isTTSMode ? 
            'Listening for dialogue...' : 
            'Listening for sound search...';
    };

    recognition.onend = () => {
        // Always restart if we're supposed to be listening
        if (isListening) {
            try {
                recognition.start();
            } catch (error) {
                console.error('Error restarting recognition:', error);
                // More aggressive retry with increasing delays
                let retryDelay = 100;
                const maxRetries = 5;
                let retryCount = 0;

                const retryStart = () => {
                    if (!isListening) return; // Stop retrying if we're not supposed to listen anymore
                    
                    try {
                        recognition.start();
                    } catch (retryError) {
                        console.error(`Failed to restart recognition, attempt ${retryCount + 1}:`, retryError);
                        if (retryCount < maxRetries) {
                            retryCount++;
                            retryDelay *= 2; // Exponential backoff
                            setTimeout(retryStart, retryDelay);
                        } else {
                            console.error('Max retries reached, reinitializing recognition');
                            // If all retries fail, reinitialize the recognition object
                            initializeSpeechRecognition();
                            setTimeout(() => {
                                if (isListening) recognition.start();
                            }, 500);
                        }
                    }
                };

                setTimeout(retryStart, retryDelay);
            }
        } else {
            const activeButton = isTTSMode ? ttsButton : micButton;
            activeButton.classList.remove('recording');
            status.textContent = 'Click a button to start';
        }
    };

    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        
        // Handle different types of errors
        switch (event.error) {
            case 'no-speech':
                // Ignore no-speech errors, keep listening
                return;
                
            case 'audio-capture':
            case 'not-allowed':
            case 'permission-denied':
                permissionGranted = false;
                isListening = false;
                status.textContent = 'Microphone permission needed. Please reload the page.';
                const activeButton = isTTSMode ? ttsButton : micButton;
                activeButton.classList.remove('recording');
                break;
                
            case 'network':
                // For network errors, try to restart after a delay
                setTimeout(() => {
                    if (isListening) {
                        try {
                            recognition.start();
                        } catch (error) {
                            console.error('Error recovering from network error:', error);
                        }
                    }
                }, 1000);
                break;
                
            default:
                // For other errors, try to recover if we should be listening
                if (isListening) {
                    try {
                        recognition.abort();
                        setTimeout(() => {
                            if (isListening) {
                                recognition.start();
                            }
                        }, 100);
                    } catch (error) {
                        console.error('Error recovering from recognition error:', error);
                        // If recovery fails, reinitialize
                        initializeSpeechRecognition();
                        setTimeout(() => {
                            if (isListening) recognition.start();
                        }, 500);
                    }
                }
        }
    };

    recognition.onresult = (event) => {
        const lastResultIndex = event.results.length - 1;
        const transcript = event.results[lastResultIndex][0].transcript.toLowerCase();
        transcription.textContent = `You said: "${transcript}"`;
        
        if (transcript.includes('assistant turn off')) {
            speak('Turning off. Goodbye!', null, null, true);
            turnOffAssistant();
            return;
        }

        switch(currentMode) {
            case 'sfx':
                handleVoiceCommand(transcript);
                break;
            case 'dialogue':
                handleDialogueCommand(transcript);
                break;
            case 'timeline':
                handleTimelineCommand(transcript);
                break;
        }
    };
}

// Initialize speech recognition on page load
initializeSpeechRecognition();

// Event Listeners for both buttons
micButton.addEventListener('click', async () => {
    isTTSMode = false;
    await startListening();
});

ttsButton.addEventListener('click', async () => {
    isTTSMode = true;
    await startListening();
});

async function startListening() {
    if (!recognition) {
        initializeSpeechRecognition();
    }
    
    try {
        if (!permissionGranted) {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
            permissionGranted = true;
        }
        
        if (!isListening) {
            startAssistant();
        }
    } catch (error) {
        console.error('Error getting microphone permission:', error);
        speak('Microphone permission is needed. Please enable it and try again.');
        status.textContent = 'Microphone permission needed. Click to try again.';
    }
}

function startAssistant() {
    if (!recognition) {
        initializeSpeechRecognition();
    }
    
    isListening = true;
    try {
        recognition.start();
    } catch (error) {
        console.error('Error starting recognition:', error);
        initializeSpeechRecognition();
        setTimeout(() => recognition.start(), 100);
    }
}

function turnOffAssistant() {
    isListening = false;
    ttsState.waitingForPreferences = false;
    ttsState.text = null;
    try {
        recognition.stop();
    } catch (error) {
        console.error('Error stopping recognition:', error);
    }
    status.textContent = 'Click a button to start';
    const activeButton = isTTSMode ? ttsButton : micButton;
    activeButton.classList.remove('recording');
    
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
        soundResults.innerHTML = '';
    }
}

// Function to parse speech command for text, accent, and tone
function parseSpeechCommand(transcript) {
    // Remove any "say" prefix if it exists
    transcript = transcript.replace(/^say\s+/i, '').trim();
    
    let text = transcript;
    let accent = null;
    let tone = null;
    
    // Check for tone specification (with "in a" or "with a" or just "in")
    const toneMatch = transcript.match(/\s+(?:in|with)\s+(?:a\s+|an\s+)?(\w+)\s+(?:tone|voice|mood)$/i);
    if (toneMatch && TONES[toneMatch[1].toLowerCase()]) {
        tone = toneMatch[1].toLowerCase();
        text = transcript.slice(0, toneMatch.index);
    }
    
    // Check if there's an accent specified
    const accentMatch = text.match(/\s+in\s+(?:a\s+|an\s+)?(\w+)(?:\s+accent)?$/i);
    if (accentMatch) {
        accent = accentMatch[1];
        text = text.slice(0, accentMatch.index);
    }
    
    return {
        text: text.trim(),
        accent: accent,
        tone: tone
    };
}

// Enhanced speak function that handles accents and tones
function speak(text, accent = null, tone = null, isSystemMessage = false) {
    if (!isSystemMessage) {
        ttsState.currentAccent = accent;
        ttsState.currentTone = tone;
    }
    
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    
    if (accent && !isSystemMessage) {
        const voice = findVoiceForAccent(accent);
        utterance.voice = voice;
        utterance.lang = voice.lang;
    } else {
        // Use default system voice for system messages
        const defaultVoice = availableVoices.find(v => v.lang.includes('en-US')) || availableVoices[0];
        utterance.voice = defaultVoice;
        utterance.lang = defaultVoice.lang;
    }
    
    // Apply tone settings if specified, otherwise use defaults
    const toneSettings = tone ? TONES[tone] : TONES['normal'];
    
    utterance.pitch = isSystemMessage ? 1.0 : toneSettings.pitch;
    utterance.rate = isSystemMessage ? 1.2 : toneSettings.rate;
    utterance.volume = toneSettings.volume || 1.0;
    
    window.speechSynthesis.speak(utterance);
}

async function handleVoiceCommand(transcript) {
    transcription.textContent = `You said: "${transcript}"`;
    
    // Normalize the transcript for better matching
    const normalized = transcript.toLowerCase().trim();
    
    // Handle stop commands first
    if (normalized.includes('stop') || normalized.includes('pause')) {
        // Stop any playing audio
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
        }
        
        // Stop any speech synthesis
        window.speechSynthesis.cancel();
        
        // Stop timeline if it's playing
        if (isPlaying) {
            stopTimeline();
        }
        
        // Clear the current playing sound display
        soundResults.innerHTML = '';
        
        status.textContent = 'Playback stopped';
        speak('Playback stopped', null, null, true);
        return;
    }

    // More flexible library play command matching
    const libraryPlayPatterns = [
        /from\s*library\s*,?\s*play\s*(?:sound\s*)?([a-zA-Z0-9]+)/i,  // "from library play 1" or "from library, play sound 1"
        /play\s*(?:sound\s*)?([a-zA-Z0-9]+)\s*from\s*library/i,      // "play 1 from library" or "play sound 1 from library"
        /library\s*,?\s*play\s*(?:sound\s*)?([a-zA-Z0-9]+)/i,         // "library play 1" or "library, play 1"
        /play\s*(?:sound\s*)?([a-zA-Z0-9]+)/i                         // just "play 1" or "play sound 1"
    ];

    // Try each pattern
    let reference = null;
    for (const pattern of libraryPlayPatterns) {
        const match = normalized.match(pattern);
        if (match) {
            reference = match[1].trim();
            break;
        }
    }

    if (reference) {
        // Normalize the reference (handle both "one" and "1", "a" and "A")
        reference = normalizeReference(reference);
        if (!reference) {
            const message = "I didn't understand that reference. Please use numbers (1, 2, 3) or letters (A, B, C).";
            status.textContent = message;
            speak(message, null, null, true);
            return;
        }

        let foundItem = null;
        let itemType = null;

        // Try to find in sound effects (numbers)
        if (!isNaN(reference)) {
            foundItem = soundLibrary.sfx.find(item => item.refId === parseInt(reference));
            if (foundItem) itemType = 'sfx';
        }
        
        // Try to find in dialogue (letters)
        if (!foundItem) {
            foundItem = soundLibrary.dialogue.find(item => item.refId === reference);
            if (foundItem) itemType = 'dialogue';
        }

        if (foundItem) {
            status.textContent = `Playing from library: ${foundItem.displayName}`;
            previewSound(itemType, foundItem.id);
            return;
        } else {
            const availableItems = getAvailableLibraryItems();
            const message = availableItems === 'No items in library' 
                ? 'The library is empty. Save some sounds or dialogue first.'
                : `Couldn't find ${reference} in library. Available items: ${availableItems}`;
            status.textContent = message;
            speak(message, null, null, true);
            return;
        }
    }

    // Check for save commands
    if (transcript.includes('save this') || transcript.includes('save that') || transcript.includes('keep this')) {
        if (lastPlayedSound && currentMode === 'sfx') {
            addToLibrary('sfx', {
                name: lastPlayedSound.name,
                url: lastPlayedSound.url,
                duration: lastPlayedSound.duration || 2
            });
            speak('Sound effect saved to library', null, null, true);
            status.textContent = `Saved: ${lastPlayedSound.name}`;
            return;
        } else if (ttsState.text && currentMode === 'dialogue') {
            addToLibrary('dialogue', {
                text: ttsState.text,
                accent: ttsState.currentAccent,
                tone: ttsState.currentTone,
                duration: 2 // Default duration, can be adjusted
            });
            speak('Dialogue saved to library', null, null, true);
            status.textContent = `Saved dialogue: "${ttsState.text}"`;
            return;
        } else {
            speak('Nothing to save. Play a sound or record dialogue first.', null, null, true);
            return;
        }
    }

    // Check for control commands
    if (transcript.includes('stop') || transcript.includes('pause')) {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
            status.textContent = 'Playback stopped';
            speak('Playback stopped', null, null, true);
        }
        return;
    }

    // Check for "next" command
    if (transcript.includes('next')) {
        playNextSound();
        return;
    }

    // Original sound search functionality
    status.textContent = `Looking for "${transcript}"...`;
    
    try {
        const response = await fetch(
            `https://freesound.org/apiv2/search/text/?query=${encodeURIComponent(transcript)}&fields=id,name,previews,duration&format=json`,
            {
                headers: {
                    'Authorization': `Token ${FREESOUND_API_KEY}`
                }
            }
        );

        if (!response.ok) {
            throw new Error('Failed to fetch sounds');
        }

        const data = await response.json();
        
        if (data.results.length === 0) {
            const message = `Sorry, I couldn't find any sounds matching "${transcript}". Try something else!`;
            status.textContent = message;
            speak(message, null, null, true);
            currentSearchResults = [];
            currentSoundIndex = -1;
            return;
        }

        // Store the search results and reset index
        currentSearchResults = data.results;
        currentSoundIndex = 0;
        
        // Play the first matching sound
        playCurrentSound();
        
    } catch (error) {
        console.error('Error searching sounds:', error);
        const message = 'Sorry, I had trouble finding sounds. Please try again.';
        status.textContent = message;
        speak(message, null, null, true);
    }
}

function playNextSound() {
    if (currentSearchResults.length === 0) {
        const message = 'No more sounds available. Try a new search!';
        status.textContent = message;
        speak(message, null, null, true);
        return;
    }
    
    if (currentSoundIndex < currentSearchResults.length - 1) {
        currentSoundIndex++;
        playCurrentSound();
    } else {
        const message = 'That was the last sound in the list. Try a new search!';
        status.textContent = message;
        speak(message, null, null, true);
    }
}

function playCurrentSound() {
    if (currentSoundIndex >= 0 && currentSoundIndex < currentSearchResults.length) {
        const sound = currentSearchResults[currentSoundIndex];
        lastPlayedSound = {
            name: sound.name,
            url: sound.previews['preview-hq-mp3'],
            duration: sound.duration
        };
        
        const message = `Playing: ${sound.name} (Sound ${currentSoundIndex + 1} of ${currentSearchResults.length}). Say "save this" to keep it, or "next" for the next sound.`;
        status.textContent = message;
        speak(message, null, null, true);
        
        // Display a simple player UI with next button
        soundResults.innerHTML = `
            <div class="sound-item current-playing">
                <span>🎵 Now Playing: ${sound.name}</span>
                <div class="controls">
                    <button class="stop-button" onclick="stopCurrentSound()">Stop</button>
                    ${currentSoundIndex < currentSearchResults.length - 1 ? 
                        `<button class="next-button" onclick="playNextSound()">Next</button>` : 
                        ''}
                    <button class="save-button" onclick="saveCurrentSound()">Save</button>
                </div>
            </div>
        `;
        
        playSound(sound.previews['preview-hq-mp3']);
    }
}

function playSound(url) {
    if (currentAudio) {
        currentAudio.pause();
    }
    
    currentAudio = new Audio(url);
    currentAudio.play()
        .catch(error => {
            console.error('Error playing sound:', error);
            const message = 'Sorry, I had trouble playing that sound. Please try again.';
            status.textContent = message;
            speak(message);
        });
    
    currentAudio.onended = () => {
        if (currentSoundIndex < currentSearchResults.length - 1) {
            const message = 'Sound finished. Say "next" for the next sound';
            status.textContent = message;
            speak(message);
        } else {
            const message = 'That was the last sound. Ready for a new search!';
            status.textContent = message;
            speak(message);
            soundResults.innerHTML = '';
        }
    };
}

function stopCurrentSound() {
    // Stop any playing audio
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
    
    // Stop any speech synthesis
    window.speechSynthesis.cancel();
    
    // Clear the display
    soundResults.innerHTML = '';
    
    const message = 'Playback stopped';
    status.textContent = message;
    speak(message, null, null, true);
}

function saveCurrentSound() {
    if (lastPlayedSound) {
        addToLibrary('sfx', lastPlayedSound);
        speak('Sound effect saved to library', null, null, true);
        status.textContent = `Saved: ${lastPlayedSound.name}`;
    }
}

// Function to handle TTS preferences response
function handleTTSPreferences(transcript) {
    transcript = transcript.toLowerCase();
    
    // If user says no or skip, just speak the text normally
    if (transcript.includes('no') || transcript.includes('skip') || transcript.includes('just say it')) {
        speak(ttsState.text);
        status.textContent = `Speaking: "${ttsState.text}"`;
        // Keep the text in state in case user wants to save it
        ttsState.waitingForPreferences = false;
        return;
    }

    let accent = null;
    let tone = null;

    // Check for accent
    for (const [accentName, langCode] of Object.entries({
        'german': 'de-DE',
        'french': 'fr-FR',
        'british': 'en-GB',
        'american': 'en-US',
        'australian': 'en-AU',
        'indian': 'en-IN',
        'spanish': 'es-ES',
        'italian': 'it-IT',
        'japanese': 'ja-JP',
        'chinese': 'zh-CN',
        'russian': 'ru-RU'
    })) {
        if (transcript.includes(accentName)) {
            accent = accentName;
            break;
        }
    }

    // Check for tone
    for (const toneName of Object.keys(TONES)) {
        if (transcript.includes(toneName)) {
            tone = toneName;
            break;
        }
    }

    // Store the accent and tone in state
    ttsState.currentAccent = accent;
    ttsState.currentTone = tone;

    // Speak the text with the selected preferences
    speak(ttsState.text, accent, tone);
    
    // Update status with what we're doing
    let message = `Speaking: "${ttsState.text}"`;
    if (accent) message += ` in ${accent} accent`;
    if (tone) message += ` with ${tone} tone`;
    message += '. Say "save this" to keep it.';
    
    status.textContent = message;
    ttsState.waitingForPreferences = false;
}

// Add these helper functions for number and time parsing
function parseSpokenNumber(word) {
    const numberWords = {
        'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4,
        'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9,
        'ten': 10, 'eleven': 11, 'twelve': 12, 'thirteen': 13,
        'fourteen': 14, 'fifteen': 15, 'sixteen': 16, 'seventeen': 17,
        'eighteen': 18, 'nineteen': 19, 'twenty': 20
    };
    
    // If it's a numeric string, return the number
    if (!isNaN(word)) {
        return parseInt(word);
    }
    
    // Check if it's a word number
    return numberWords[word.toLowerCase()];
}

function parseNaturalTime(timeStr) {
    const words = timeStr.toLowerCase().split(' ');
    let totalSeconds = 0;
    
    for (let i = 0; i < words.length; i++) {
        const num = parseSpokenNumber(words[i]);
        if (num !== undefined) {
            // Look at the next word for the unit
            const nextWord = (i + 1 < words.length) ? words[i + 1] : '';
            if (nextWord.startsWith('minute') || nextWord === 'min') {
                totalSeconds += num * 60;
                i++; // Skip the unit word
            } else if (nextWord.startsWith('second') || nextWord === 'sec') {
                totalSeconds += num;
                i++; // Skip the unit word
            } else {
                // If no unit specified, assume seconds
                totalSeconds += num;
            }
        }
    }
    
    return totalSeconds;
}

// Update the normalizeCommand function to be more thorough
function normalizeCommand(transcript) {
    // Remove all extra spaces (including leading/trailing) and convert to lowercase
    const cleaned = transcript.toLowerCase()
        .replace(/^\s+|\s+$/g, '')     // Remove leading/trailing spaces
        .replace(/\s+/g, ' ');         // Normalize internal spaces to single spaces
    
    console.log('Original transcript:', transcript);
    console.log('Cleaned command:', cleaned);
    return cleaned;
}

// Helper function to check if a command is present in a string
function hasCommand(str, commands) {
    // Normalize the string first
    const normalized = normalizeCommand(str);
    
    // If commands is a string, convert it to array
    const cmdArray = Array.isArray(commands) ? commands : [commands];
    
    // Check each command
    return cmdArray.some(cmd => {
        // Remove spaces from both strings before comparing
        const cleanCmd = cmd.replace(/\s+/g, '');
        const cleanStr = normalized.replace(/\s+/g, '');
        return cleanStr.includes(cleanCmd);
    });
}

// Add helper to extract time from a string
function findTimeInString(str) {
    const words = str.split(' ');
    let timeStr = '';
    let foundTime = false;
    
    // Look for number followed by time unit
    for (let i = 0; i < words.length; i++) {
        const num = parseSpokenNumber(words[i]);
        if (num !== undefined) {
            const nextWord = (i + 1 < words.length) ? words[i + 1] : '';
            if (nextWord.startsWith('minute') || nextWord.startsWith('second') || 
                nextWord === 'min' || nextWord === 'sec') {
                timeStr = words.slice(i).join(' ');
                foundTime = true;
                break;
            }
        }
    }
    
    if (!foundTime) {
        // Look for just numbers as seconds
        for (let i = 0; i < words.length; i++) {
            const num = parseSpokenNumber(words[i]);
            if (num !== undefined) {
                timeStr = `${words[i]} seconds`;
                break;
            }
        }
    }
    
    return timeStr;
}

// Add helper to find reference (number or letter) in string
function findReferenceInString(str) {
    const words = str.split(' ');
    
    for (const word of words) {
        // Check if it's a letter reference
        if (word.length === 1 && word.match(/[a-z]/i)) {
            return word;
        }
        
        // Check if it's a number reference
        const num = parseSpokenNumber(word);
        if (num !== undefined) {
            return word;
        }
    }
    
    return null;
}

// Update handleTimelineCommand function
function handleTimelineCommand(transcript) {
    console.log('Raw command:', transcript);
    const normalized = normalizeCommand(transcript);
    console.log('Normalized command:', normalized);
    
    // Handle timeline playback commands with more variations
    const playCommands = [
        'playtimeline', 'playall', 'playeverything',
        'playtracks', 'play', 'starttimeline', 'start'
    ];
    
    const stopCommands = [
        'stop', 'pause', 'halt', 'end',
        'stoptimeline', 'pausetimeline', 'endtimeline'
    ];
    
    // Check for "play from" command
    if (normalized.includes('play from') || normalized.includes('start from')) {
        const timeStr = findTimeInString(normalized);
        if (timeStr) {
            const startTime = parseNaturalTime(timeStr);
            playTimelineFrom(startTime);
            speak(`Playing timeline from ${formatTime(startTime)}`, null, null, true);
            return;
        } else {
            speak('Please specify a time to start from, like "play from 30 seconds" or "start from 2 minutes"', null, null, true);
            return;
        }
    }
    
    // Check for play commands
    if (hasCommand(normalized, playCommands)) {
        playTimeline();
        speak('Playing timeline', null, null, true);
        return;
    }
    
    // Check for stop commands
    if (hasCommand(normalized, stopCommands)) {
        stopTimeline();
        speak('Stopped timeline', null, null, true);
        return;
    }
    
    // Handle delete commands
    if (hasCommand(normalized, ['delete', 'remove'])) {
        const reference = findReferenceInString(normalized);
        if (reference) {
            const success = deleteFromTimeline(reference);
            if (success) {
                speak(`Deleted item ${reference} from timeline`, null, null, true);
            } else {
                speak(`Could not find item ${reference} in the timeline`, null, null, true);
            }
            return;
        } else {
            speak('Please specify what to delete by its number or letter', null, null, true);
            return;
        }
    }
    
    // Handle add commands
    if (hasCommand(normalized, 'add')) {
        console.log('Processing add command');
        
        // Find reference (number or letter) and time anywhere in the command
        const reference = findReferenceInString(normalized);
        const timeStr = findTimeInString(normalized);
        
        console.log('Found reference:', reference);
        console.log('Found time string:', timeStr);
        
        if (!reference || !timeStr) {
            speak('Please say something like: add (number or letter) at (time)', null, null, true);
            return;
        }
        
        const startTime = parseNaturalTime(timeStr);
        console.log('Parsed start time:', startTime);
        
        // Try sound effect first
        const numberValue = parseSpokenNumber(reference);
        if (numberValue !== undefined) {
            const sound = soundLibrary.sfx.find(s => s.refId === numberValue);
            if (sound) {
                addToTimelineAtTime('sfx', sound.id, startTime);
                speak(`Added sound ${numberValue} at ${formatTime(startTime)}`, null, null, true);
                return;
            }
        }
        
        // Try dialogue
        if (reference.length === 1) {
            const dialogue = soundLibrary.dialogue.find(d => 
                d.refId.toLowerCase() === reference.toLowerCase()
            );
            if (dialogue) {
                addToTimelineAtTime('dialogue', dialogue.id, startTime);
                speak(`Added dialogue ${reference} at ${formatTime(startTime)}`, null, null, true);
                return;
            }
        }
        
        speak('Could not find that sound or dialogue', null, null, true);
        return;
    }
    
    // Handle other commands
    if (hasCommand(normalized, ['newtrack', 'addtrack'])) {
        addNewTrack();
        speak('Added new track', null, null, true);
    }
    else if (hasCommand(normalized, 'save')) {
        saveProject();
        speak('Timeline saved', null, null, true);
    }
    else {
        speak('Try saying: "add (number or letter) at (time)", "delete (number or letter)", "play from (time)", or "play"', null, null, true);
    }
}

// Function to delete an item from the timeline by its reference (number or letter)
function deleteFromTimeline(reference) {
    let found = false;
    
    // Convert reference to number if it's a numeric reference
    const numberRef = parseSpokenNumber(reference);
    
    timelineTracks.forEach(track => {
        const clipIndex = track.clips.findIndex(clip => {
            const sourceItem = soundLibrary[clip.type].find(item => item.id === clip.sourceId);
            if (!sourceItem) return false;
            
            if (numberRef !== undefined) {
                return sourceItem.refId === numberRef;
            } else {
                return sourceItem.refId.toLowerCase() === reference.toLowerCase();
            }
        });
        
        if (clipIndex !== -1) {
            track.clips.splice(clipIndex, 1);
            found = true;
        }
    });
    
    if (found) {
        displayTimeline();
        saveProject();
    }
    
    return found;
}

// Function to play timeline from a specific time
function playTimelineFrom(startTimeSeconds) {
    if (isPlaying) {
        stopTimeline();
    }
    
    try {
        // Initialize audio context if needed
        initializeAudioContext();
        
        isPlaying = true;
        currentTime = startTimeSeconds;
        status.textContent = `Playing timeline from ${formatTime(startTimeSeconds)}...`;
        
        // Find all clips that are relevant from this time point
        const relevantClips = timelineTracks.flatMap(track => 
            track.clips.filter(clip => 
                // Include clips that:
                // 1. Start after our current time OR
                // 2. Started before but would still be playing (start + duration > current)
                clip.startTime >= startTimeSeconds || 
                (clip.startTime + clip.duration) > startTimeSeconds
            )
        );

        if (relevantClips.length === 0) {
            speak('No clips to play from this time.', null, null, true);
            stopTimeline();
            return;
        }

        // Find the end time of the last relevant clip
        const lastEndTime = Math.max(...relevantClips.map(clip => clip.startTime + clip.duration));
        
        console.log('Starting playback from:', startTimeSeconds);
        console.log('Relevant clips:', relevantClips);
        console.log('Last end time:', lastEndTime);

        // Reset hasStarted flag based on clip position relative to start time
        timelineTracks.forEach(track => {
            track.clips.forEach(clip => {
                // Mark as started only if the clip should have completely finished by our start time
                clip.hasStarted = (clip.startTime + clip.duration) <= startTimeSeconds;
            });
        });

        // Start the playback loop
        playbackInterval = setInterval(() => {
            // Check each track's clips
            timelineTracks.forEach(track => {
                track.clips.forEach(clip => {
                    // A clip should play if:
                    // 1. It hasn't started yet AND
                    // 2. Its start time is less than or equal to current time
                    if (!clip.hasStarted && currentTime >= clip.startTime) {
                        console.log(`Starting clip at ${formatTime(currentTime)}:`, clip);
                        
                        // For clips that should have started before our start time,
                        // we need to start them at the correct offset
                        if (clip.startTime < startTimeSeconds) {
                            const offset = startTimeSeconds - clip.startTime;
                            playClipFromOffset(clip, offset);
                        } else {
                            playClip(clip);
                        }
                        
                        clip.hasStarted = true;
                    }
                });
            });

            // Update time display
            currentTime += 0.1;
            timeDisplay.textContent = formatTime(currentTime);

            // Check if we've reached the end
            if (currentTime >= lastEndTime + 0.5) {
                stopTimeline();
            }
        }, 100);

    } catch (error) {
        console.error('Error starting timeline playback:', error);
        speak('There was an error playing the timeline. Please try again.', null, null, true);
        stopTimeline();
    }
}

// New function to play a clip from a specific offset
async function playClipFromOffset(clip, offsetSeconds) {
    try {
        console.log('Playing clip from offset:', offsetSeconds, clip);
        const sourceItem = soundLibrary[clip.type].find(item => item.id === clip.sourceId);
        if (!sourceItem) {
            console.error('Source item not found for clip:', clip);
            return;
        }

        if (clip.type === 'sfx') {
            try {
                let audioData;
                if (sourceItem.url.startsWith('data:')) {
                    audioData = await fetch(sourceItem.url).then(r => r.arrayBuffer());
                } else {
                    const response = await fetch(sourceItem.url);
                    if (!response.ok) throw new Error('Failed to fetch sound effect');
                    audioData = await response.arrayBuffer();
                }
                
                const audioBuffer = await audioContext.decodeAudioData(audioData);
                const source = audioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(audioContext.destination);
                
                // Start the audio from the offset position
                const startOffset = Math.min(offsetSeconds, audioBuffer.duration);
                source.start(0, startOffset);
                
                clip.audioSource = source;
                console.log('Playing SFX from offset:', sourceItem.name, startOffset);
            } catch (error) {
                console.error('Error playing sound effect with offset:', error);
            }
        } else if (clip.type === 'dialogue') {
            // For dialogue, we'll need to estimate how much text to skip
            const utterance = new SpeechSynthesisUtterance(sourceItem.text);
            
            if (sourceItem.accent) {
                const voice = findVoiceForAccent(sourceItem.accent);
                if (voice) {
                    utterance.voice = voice;
                    utterance.lang = voice.lang;
                }
            }
            
            if (sourceItem.tone && TONES[sourceItem.tone]) {
                const toneSettings = TONES[sourceItem.tone];
                utterance.pitch = toneSettings.pitch;
                utterance.rate = toneSettings.rate;
                utterance.volume = toneSettings.volume || 1.0;
            }

            // Store the utterance in the clip for potential stopping
            clip.utterance = utterance;

            // Start speaking
            window.speechSynthesis.speak(utterance);
        }
    } catch (error) {
        console.error('Error playing clip from offset:', error);
    }
}

// Function to record TTS audio and return as base64
async function recordTTSAudio(text, accent, tone) {
    return new Promise((resolve, reject) => {
        try {
            console.log('Starting TTS recording process...');
            
            // Create an audio element to play and capture the speech
            const audio = document.createElement('audio');
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const destination = audioContext.createMediaStreamDestination();
            const mediaRecorder = new MediaRecorder(destination.stream, {
                mimeType: 'audio/webm;codecs=opus'
            });
            const audioChunks = [];

            mediaRecorder.ondataavailable = (event) => {
                console.log('Got audio data chunk:', event.data.size, 'bytes');
                if (event.data.size > 0) {
                    audioChunks.push(event.data);
                }
            };

            mediaRecorder.onstop = () => {
                console.log('MediaRecorder stopped, processing audio...');
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                console.log('Created audio blob:', audioBlob.size, 'bytes');
                const reader = new FileReader();
                reader.onloadend = () => {
                    console.log('Audio converted to base64');
                    resolve(reader.result);
                };
                reader.onerror = (error) => {
                    console.error('Error reading audio blob:', error);
                    reject(error);
                };
                reader.readAsDataURL(audioBlob);
            };

            // Create and configure utterance
            const utterance = new SpeechSynthesisUtterance(text);
            
            if (accent) {
                const voice = findVoiceForAccent(accent);
                if (voice) {
                    utterance.voice = voice;
                    utterance.lang = voice.lang;
                    console.log('Applied voice:', voice.name);
                }
            }
            
            if (tone && TONES[tone]) {
                const toneSettings = TONES[tone];
                utterance.pitch = toneSettings.pitch;
                utterance.rate = toneSettings.rate;
                utterance.volume = toneSettings.volume || 1.0;
                console.log('Applied tone settings:', tone);
            }

            // Start recording
            mediaRecorder.start();
            console.log('Started MediaRecorder');

            // Handle TTS events
            utterance.onstart = () => {
                console.log('TTS started speaking');
            };

            utterance.onend = () => {
                console.log('TTS finished speaking');
                setTimeout(() => {
                    console.log('Stopping MediaRecorder...');
                    if (mediaRecorder.state === 'recording') {
                        mediaRecorder.stop();
                    }
                    audioContext.close();
                }, 500);
            };

            utterance.onerror = (error) => {
                console.error('TTS Error:', error);
                if (mediaRecorder.state === 'recording') {
                    mediaRecorder.stop();
                }
                audioContext.close();
                reject(error);
            };

            // Start speaking
            console.log('Starting speech synthesis...');
            window.speechSynthesis.speak(utterance);

        } catch (error) {
            console.error('Error in recordTTSAudio:', error);
            reject(error);
        }
    });
}

// Helper function to convert speech to audio data
function speakToAudioData(text, accent, tone) {
    return new Promise((resolve, reject) => {
        const utterance = new SpeechSynthesisUtterance(text);
        
        if (accent) {
            const voice = findVoiceForAccent(accent);
            if (voice) {
                utterance.voice = voice;
                utterance.lang = voice.lang;
            }
        }
        
        if (tone && TONES[tone]) {
            const toneSettings = TONES[tone];
            utterance.pitch = toneSettings.pitch;
            utterance.rate = toneSettings.rate;
            utterance.volume = toneSettings.volume || 1.0;
        }

        // Create an audio element to capture the speech
        const audio = new Audio();
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Create a MediaRecorder to capture the audio
        const stream = audio.captureStream();
        const mediaRecorder = new MediaRecorder(stream);
        const chunks = [];

        mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
        mediaRecorder.onstop = () => {
            const blob = new Blob(chunks, { type: 'audio/wav' });
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        };

        mediaRecorder.start();
        window.speechSynthesis.speak(utterance);

        utterance.onend = () => {
            setTimeout(() => mediaRecorder.stop(), 100);
        };

        utterance.onerror = reject;
    });
}

// Modified handleDialogueCommand to store speech settings instead of recording
async function handleDialogueCommand(transcript) {
    if (ttsState.waitingForPreferences) {
        if (transcript.includes('save this') || transcript.includes('save that') || transcript.includes('keep this')) {
            if (ttsState.text) {
                try {
                    // Calculate duration taking tone into account
                    const duration = estimateDialogueDuration(ttsState.text, ttsState.currentTone);
                    
                    // Save the dialogue with speech settings
                    const dialogueItem = {
                        id: Date.now(),
                        text: ttsState.text,
                        accent: ttsState.currentAccent,
                        tone: ttsState.currentTone,
                        duration: duration,
                        type: 'dialogue'
                    };
                    
                    addToLibrary('dialogue', dialogueItem);
                    speak('Dialogue saved to library', null, null, true);
                    status.textContent = `Saved dialogue: "${ttsState.text}" (${formatTime(duration)})`;
                    ttsState.waitingForPreferences = false;
                    ttsState.text = null;
                } catch (error) {
                    console.error('Error saving dialogue:', error);
                    speak('Error saving dialogue', null, null, true);
                    status.textContent = 'Error saving dialogue';
                }
                return;
            }
        }
        handleTTSPreferences(transcript);
    } else {
        // Check for save command for previously spoken dialogue
        if (transcript.includes('save this') || transcript.includes('save that') || transcript.includes('keep this')) {
            if (ttsState.text && ttsState.currentAccent) {
                // Save the dialogue with speech settings
                const dialogueItem = {
                    id: Date.now(),
                    text: ttsState.text,
                    accent: ttsState.currentAccent,
                    tone: ttsState.currentTone,
                    duration: estimateDialogueDuration(ttsState.text, ttsState.currentTone),
                    type: 'dialogue'
                };
                
                addToLibrary('dialogue', dialogueItem);
                speak('Dialogue saved to library', null, null, true);
                status.textContent = `Saved dialogue: "${ttsState.text}" (${formatTime(estimateDialogueDuration(ttsState.text, ttsState.currentTone))})`;
                ttsState.text = null;
                return;
            } else {
                speak('Please speak your dialogue first', null, null, true);
                return;
            }
        }
        
        // Store the new dialogue text and ask for preferences
        ttsState.text = transcript;
        ttsState.waitingForPreferences = true;
        const promptMessage = 'Would you like a specific accent or tone? Say no to skip, or specify like "British accent" or "happy tone" or both.';
        status.textContent = promptMessage;
        speak(promptMessage, null, null, true);
    }
}

// Update playClip to handle dialogue using speech synthesis
async function playClip(clip) {
    try {
        console.log('Playing clip:', clip);
        const sourceItem = soundLibrary[clip.type].find(item => item.id === clip.sourceId);
        if (!sourceItem) {
            console.error('Source item not found for clip:', clip);
            return;
        }

        console.log('Found source item:', sourceItem);

        if (clip.type === 'sfx') {
            try {
                let audioData;
                if (sourceItem.url.startsWith('data:')) {
                    console.log('Loading base64 audio data...');
                    audioData = await fetch(sourceItem.url).then(r => r.arrayBuffer());
                } else {
                    console.log('Fetching audio from URL...');
                    const response = await fetch(sourceItem.url);
                    if (!response.ok) throw new Error('Failed to fetch sound effect');
                    audioData = await response.arrayBuffer();
                }
                
                console.log('Decoding audio data...');
                const audioBuffer = await audioContext.decodeAudioData(audioData);
                const source = audioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(audioContext.destination);
                source.start();
                
                clip.audioSource = source;
                console.log('Playing SFX:', sourceItem.name);
            } catch (error) {
                console.error('Error playing sound effect:', error);
                speak('Error playing sound effect', null, null, true);
            }
        } else if (clip.type === 'dialogue') {
            try {
                console.log('Playing dialogue:', sourceItem.text);
                
                // Create and configure utterance
                const utterance = new SpeechSynthesisUtterance(sourceItem.text);
                
                if (sourceItem.accent) {
                    const voice = findVoiceForAccent(sourceItem.accent);
                    if (voice) {
                        utterance.voice = voice;
                        utterance.lang = voice.lang;
                    }
                }
                
                if (sourceItem.tone && TONES[sourceItem.tone]) {
                    const toneSettings = TONES[sourceItem.tone];
                    utterance.pitch = toneSettings.pitch;
                    utterance.rate = toneSettings.rate;
                    utterance.volume = toneSettings.volume || 1.0;
                }

                // Store the utterance in the clip for potential stopping
                clip.utterance = utterance;

                // Speak the dialogue
                window.speechSynthesis.speak(utterance);
                
                console.log('Started speaking dialogue:', sourceItem.text);
            } catch (error) {
                console.error('Error playing dialogue:', error);
                console.error('Error details:', error.message);
                speak('Error playing dialogue', null, null, true);
            }
        }
    } catch (error) {
        console.error('Error playing clip:', error);
        speak('Error playing clip', null, null, true);
    }
}

// Update stopTimeline to handle stopping dialogue properly
function stopTimeline() {
    isPlaying = false;
    clearInterval(playbackInterval);
    currentTime = 0;
    timeDisplay.textContent = formatTime(0);
    
    // Stop all currently playing audio
    if (audioContext) {
        timelineTracks.forEach(track => {
            track.clips.forEach(clip => {
                if (clip.audioSource) {
                    try {
                        clip.audioSource.stop();
                    } catch (e) {
                        console.error('Error stopping audio source:', e);
                    }
                    clip.audioSource = null;
                }
                if (clip.utterance) {
                    window.speechSynthesis.cancel();
                    clip.utterance = null;
                }
            });
        });
    }
    
    status.textContent = 'Timeline stopped';
}

// Update estimateDialogueDuration to be more accurate
function estimateDialogueDuration(text, tone) {
    // Base speaking rate (words per minute)
    let wordsPerMinute = 150;
    
    // Adjust rate based on tone
    if (tone && TONES[tone]) {
        wordsPerMinute = wordsPerMinute * TONES[tone].rate;
    }
    
    const wordsCount = text.split(/\s+/).length;
    const minutesNeeded = wordsCount / wordsPerMinute;
    return Math.max(Math.ceil(minutesNeeded * 60), 2); // Return in seconds
}

// Function to preview dialogue from library
function previewSound(type, itemId) {
    console.log('Previewing sound:', type, itemId);
    const item = soundLibrary[type].find(i => i.id === itemId);
    if (!item) {
        console.error('Item not found:', itemId);
        return;
    }

    if (type === 'sfx') {
        const audio = new Audio(item.url);
        audio.play().catch(error => {
            console.error('Error playing sound:', error);
        });
    } else if (type === 'dialogue') {
        // Create and configure utterance for preview
        const utterance = new SpeechSynthesisUtterance(item.text);
        
        if (item.accent) {
            const voice = findVoiceForAccent(item.accent);
            if (voice) {
                utterance.voice = voice;
                utterance.lang = voice.lang;
            }
        }
        
        if (item.tone && TONES[item.tone]) {
            const toneSettings = TONES[item.tone];
            utterance.pitch = toneSettings.pitch;
            utterance.rate = toneSettings.rate;
            utterance.volume = toneSettings.volume || 1.0;
        }

        // Cancel any ongoing speech and speak the preview
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
    }
}

// Initialize the application
async function initializeApp() {
    // Request microphone permission once at startup
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
        permissionGranted = true;
        initializeSpeechRecognition();
    } catch (error) {
        console.error('Error getting microphone permission:', error);
        status.textContent = 'Microphone permission needed to use this app';
    }

    // Add keyboard shortcuts for mode buttons
    document.addEventListener('keydown', (event) => {
        // Only handle if not in an input field
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
            return;
        }
        
        switch(event.key) {
            case '1':
                micButton.click();
                break;
            case '2':
                ttsButton.click();
                break;
            case '3':
                timelineButton.click();
                break;
        }
    });

    // Load saved library and timeline from localStorage
    loadSavedData();
    
    // Set up tab switching
    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
            button.classList.add('active');
            displayLibraryContent(button.dataset.tab);
        });
    });

    // Timeline controls
    playButton.addEventListener('click', playTimeline);
    stopButton.addEventListener('click', stopTimeline);
    saveButton.addEventListener('click', saveProject);
    exportButton.addEventListener('click', exportAudio);
    addTrackButton.addEventListener('click', addNewTrack);

    // Mode buttons
    micButton.addEventListener('click', () => setMode('sfx'));
    ttsButton.addEventListener('click', () => setMode('dialogue'));
    timelineButton.addEventListener('click', () => setMode('timeline'));

    // Initialize timeline
    addNewTrack();
}

function setMode(mode) {
    if (!permissionGranted) {
        status.textContent = 'Microphone permission needed. Please reload the page.';
        return;
    }

    // Stop any playing sound when switching modes
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
        soundResults.innerHTML = '';
    }

    // Reset search results when switching modes
    if (currentMode !== mode) {
        currentSearchResults = [];
        currentSoundIndex = -1;
        lastPlayedSound = null;
    }

    currentMode = mode;
    document.querySelectorAll('.mic-button').forEach(btn => btn.classList.remove('recording'));
    
    switch(mode) {
        case 'sfx':
            micButton.classList.add('recording');
            status.textContent = 'Search for sound effects by voice';
            if (!isListening) {
                isListening = true;
                try {
                    recognition.start();
                } catch (error) {
                    console.error('Error starting recognition:', error);
                }
            }
            break;
        case 'dialogue':
            ttsButton.classList.add('recording');
            status.textContent = 'Record dialogue - speak your line';
            if (!isListening) {
                isListening = true;
                try {
                    recognition.start();
                } catch (error) {
                    console.error('Error starting recognition:', error);
                }
            }
            break;
        case 'timeline':
            timelineButton.classList.add('recording');
            status.textContent = 'Timeline mode - Say "help" for available commands';
            if (!isListening) {
                isListening = true;
                try {
                    recognition.start();
                } catch (error) {
                    console.error('Error starting recognition:', error);
                }
            }
            displayTimeline();
            break;
    }
}

// Library Management
function addToLibrary(type, item) {
    console.log('Adding to library:', type, item);
    item.id = Date.now(); // Simple unique ID
    
    // Add reference number/letter
    if (type === 'sfx') {
        item.refId = nextSoundNumber++;
        item.displayName = `${item.refId}. ${item.name}`;
    } else {
        item.refId = nextDialogueLetter;
        item.displayName = `${item.refId}. ${item.text}`;
        nextDialogueLetter = String.fromCharCode(nextDialogueLetter.charCodeAt(0) + 1);
    }
    
    soundLibrary[type] = soundLibrary[type] || []; // Ensure array exists
    soundLibrary[type].push(item);
    console.log('Updated library:', soundLibrary[type]);
    saveSoundLibrary();
    displayLibraryContent(type);
}

function displayLibraryContent(type) {
    const items = soundLibrary[type];
    libraryContent.innerHTML = items.map(item => `
        <div class="sound-item" data-id="${item.id}">
            <span>${item.displayName}</span>
            <div class="controls">
                <button class="play-button" onclick="previewSound('${type}', ${item.id})">▶️</button>
                <button class="add-button" onclick="addToTimeline('${type}', ${item.id})">➕</button>
                <button onclick="deleteFromLibrary('${type}', ${item.id})">🗑️</button>
            </div>
        </div>
    `).join('');
}

// Timeline Management
function addNewTrack() {
    const trackId = Date.now();
    timelineTracks.push({
        id: trackId,
        clips: []
    });
    displayTimeline();
}

function displayTimeline() {
    timeline.innerHTML = timelineTracks.map(track => `
        <div class="timeline-track" data-track="${track.id}">
            <div class="track-content">
                ${track.clips.map(clip => `
                    <div class="timeline-clip ${clip.type}" 
                         data-clip="${clip.id}" 
                         data-track="${track.id}"
                         style="width: ${clip.duration * 50}px; left: ${clip.startTime * 50}px"
                         draggable="true">
                        <div class="clip-content">
                            <span class="clip-name">${clip.name}</span>
                            <span class="clip-time">${formatTime(clip.duration)}</span>
                            <button class="remove-clip" onclick="removeClip(${track.id}, ${clip.id})">✖️</button>
                        </div>
                    </div>
                `).join('')}
            </div>
            <div class="track-dropzone" data-track="${track.id}"></div>
        </div>
    `).join('');
    
    initializeDragAndDrop();
}

function initializeDragAndDrop() {
    const clips = document.querySelectorAll('.timeline-clip');
    const tracks = document.querySelectorAll('.timeline-track');
    let draggedClip = null;
    let originalTrack = null;
    let offsetX = 0;

    clips.forEach(clip => {
        clip.addEventListener('dragstart', (e) => {
            draggedClip = clip;
            originalTrack = clip.closest('.timeline-track');
            const rect = clip.getBoundingClientRect();
            offsetX = e.clientX - rect.left;
            clip.classList.add('dragging');
        });

        clip.addEventListener('dragend', () => {
            if (draggedClip) {
                draggedClip.classList.remove('dragging');
                draggedClip = null;
            }
        });
    });

    tracks.forEach(track => {
        track.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (!draggedClip) return;

            const trackRect = track.getBoundingClientRect();
            const trackContent = track.querySelector('.track-content');
            const newX = e.clientX - trackRect.left - offsetX;
            const newTime = Math.max(0, newX / 50); // Convert pixels to seconds

            // Update clip position in the data model
            const clipId = parseInt(draggedClip.dataset.clip);
            const trackId = parseInt(track.dataset.track);
            const sourceTrackId = parseInt(draggedClip.dataset.track);

            // Find and update the clip in the tracks array
            if (sourceTrackId !== trackId) {
                // Move clip to new track
                const sourceTrack = timelineTracks.find(t => t.id === sourceTrackId);
                const targetTrack = timelineTracks.find(t => t.id === trackId);
                if (sourceTrack && targetTrack) {
                    const clipIndex = sourceTrack.clips.findIndex(c => c.id === clipId);
                    if (clipIndex !== -1) {
                        const clip = sourceTrack.clips.splice(clipIndex, 1)[0];
                        clip.startTime = newTime;
                        targetTrack.clips.push(clip);
                    }
                }
            } else {
                // Just update position in current track
                const track = timelineTracks.find(t => t.id === trackId);
                if (track) {
                    const clip = track.clips.find(c => c.id === clipId);
                    if (clip) {
                        clip.startTime = newTime;
                    }
                }
            }

            // Update the display
            displayTimeline();
            saveProject();
        });
    });
}

function addToTimeline(type, itemId) {
    console.log('Adding to timeline:', type, itemId);
    const item = soundLibrary[type].find(i => i.id === itemId);
    if (!item) {
        console.error('Item not found in library:', type, itemId);
        return;
    }
    
    console.log('Found item:', item);
    
    // Calculate duration based on type
    let duration;
    if (type === 'dialogue') {
        duration = estimateDialogueDuration(item.text, item.tone);
    } else {
        duration = item.duration || 2;
    }
    
    // Add to the first track
    if (timelineTracks.length === 0) addNewTrack();
    
    const newClip = {
        id: Date.now(),
        type: type,
        sourceId: item.id,
        name: item.displayName,
        duration: duration,
        startTime: 0, // Default to start of timeline
        hasStarted: false
    };
    
    console.log('Adding new clip:', newClip);
    timelineTracks[0].clips.push(newClip);
    
    displayTimeline();
    saveProject();
}

// Playback Controls
async function playTimeline() {
    if (isPlaying) return;
    
    try {
        // Ensure audio context is initialized and running
        if (!audioContext || audioContext.state === 'closed') {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }
        
        isPlaying = true;
        currentTime = 0;
        status.textContent = 'Playing timeline...';
        
        // Reset all clips' hasStarted flag
        timelineTracks.forEach(track => {
            track.clips.forEach(clip => {
                clip.hasStarted = false;
            });
        });

        // Find the end time of the last clip across all tracks
        const lastEndTime = Math.max(...timelineTracks.flatMap(track => 
            track.clips.map(clip => clip.startTime + clip.duration)
        ));

        if (lastEndTime === -Infinity) {
            speak('Timeline is empty. Add some sounds or dialogue first.', null, null, true);
            stopTimeline();
            return;
        }

        // Start the playback loop
        playbackInterval = setInterval(() => {
            // Check each track's clips
            timelineTracks.forEach(track => {
                track.clips.forEach(clip => {
                    // Check if this clip should start playing
                    if (currentTime >= clip.startTime && !clip.hasStarted) {
                        console.log(`Starting clip at ${currentTime}s:`, clip);
                        playClip(clip);
                        clip.hasStarted = true;
                    }
                });
            });

            // Update time display
            currentTime += 0.1;
            timeDisplay.textContent = formatTime(currentTime);

            // Check if we've reached the end
            if (currentTime >= lastEndTime + 0.5) {
                stopTimeline();
            }
        }, 100);

    } catch (error) {
        console.error('Error starting timeline playback:', error);
        speak('There was an error playing the timeline. Please try again.', null, null, true);
        stopTimeline();
    }
}

// Utility Functions
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Storage Functions
function loadSavedData() {
    const savedLibrary = localStorage.getItem('soundLibrary');
    if (savedLibrary) {
        soundLibrary = JSON.parse(savedLibrary);
    }
    
    const savedTimeline = localStorage.getItem('timeline');
    if (savedTimeline) {
        timelineTracks = JSON.parse(savedTimeline);
    }
}

function saveSoundLibrary() {
    localStorage.setItem('soundLibrary', JSON.stringify(soundLibrary));
}

function saveProject() {
    localStorage.setItem('timeline', JSON.stringify(timelineTracks));
    status.textContent = 'Project saved!';
}

async function exportAudio() {
    // Implement audio export functionality
    status.textContent = 'Exporting audio...';
    // This would need Web Audio API implementation to mix the tracks
}

// Clear all saved data
function clearAllSavedData() {
    localStorage.clear();
    soundLibrary = {
        sfx: [],
        dialogue: []
    };
    timelineTracks = [];
    nextSoundNumber = 1;
    nextDialogueLetter = 'A';
    addNewTrack();
    displayLibraryContent('sfx');
    displayTimeline();
    status.textContent = 'All saved data has been cleared';
}

// Function to convert audio URL to base64
async function urlToBase64Audio(url) {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error('Error converting audio to base64:', error);
        throw error;
    }
}

// Modified save function to download and store audio
async function saveCurrentSound() {
    if (lastPlayedSound) {
        try {
            status.textContent = 'Downloading sound...';
            // Download and convert the audio to base64
            const audioBase64 = await urlToBase64Audio(lastPlayedSound.url);
            
            // Save with the base64 audio data
            addToLibrary('sfx', {
                name: lastPlayedSound.name,
                url: audioBase64, // Store the base64 audio data instead of URL
                duration: lastPlayedSound.duration || 2
            });
            
            speak('Sound effect saved to library', null, null, true);
            status.textContent = `Saved: ${lastPlayedSound.name}`;
        } catch (error) {
            console.error('Error saving sound:', error);
            speak('Error saving sound effect', null, null, true);
            status.textContent = 'Error saving sound effect';
        }
    }
}

// Call clearAllSavedData when the page loads to start fresh
window.addEventListener('load', () => {
    clearAllSavedData();
});

// Initialize the app
initializeApp();

// Function to preview sound from library
async function previewSound(type, itemId) {
    console.log('Previewing sound:', type, itemId);
    const item = soundLibrary[type].find(i => i.id === itemId);
    if (!item) {
        console.error('Item not found:', itemId);
        return;
    }

    // Stop any currently playing audio first
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
    window.speechSynthesis.cancel();

    // Initialize audio context if needed
    if (!audioContext || audioContext.state === 'closed') {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    // Resume audio context if suspended
    if (audioContext.state === 'suspended') {
        await audioContext.resume();
    }

    try {
        if (type === 'sfx') {
            // Create a new Audio element for the sound
            currentAudio = new Audio(item.url);
            currentAudio.play().catch(error => {
                console.error('Error playing sound:', error);
                status.textContent = 'Error playing sound';
                speak('Error playing sound', null, null, true);
            });
            
            // Update the display to show it's playing
            soundResults.innerHTML = `
                <div class="sound-item current-playing">
                    <span>🎵 Now Playing: ${item.displayName}</span>
                    <div class="controls">
                        <button class="stop-button" onclick="stopCurrentSound()">Stop</button>
                    </div>
                </div>
            `;
        } else if (type === 'dialogue') {
            // For dialogue, use speech synthesis
            const utterance = new SpeechSynthesisUtterance(item.text);
            
            if (item.accent) {
                const voice = findVoiceForAccent(item.accent);
                if (voice) {
                    utterance.voice = voice;
                    utterance.lang = voice.lang;
                }
            }
            
            if (item.tone && TONES[item.tone]) {
                const toneSettings = TONES[item.tone];
                utterance.pitch = toneSettings.pitch;
                utterance.rate = toneSettings.rate;
                utterance.volume = toneSettings.volume || 1.0;
            }

            // Update the display to show it's playing
            soundResults.innerHTML = `
                <div class="sound-item current-playing">
                    <span>🎭 Now Playing: ${item.displayName}</span>
                    <div class="controls">
                        <button class="stop-button" onclick="stopCurrentSound()">Stop</button>
                    </div>
                </div>
            `;

            // Speak the dialogue
            window.speechSynthesis.speak(utterance);
        }
    } catch (error) {
        console.error('Error previewing sound:', error);
        status.textContent = 'Error playing sound';
        speak('Error playing sound', null, null, true);
    }
}

// Add click handler to initialize audio
document.addEventListener('click', function initAudioContext() {
    if (!audioContext || audioContext.state === 'closed') {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    // Remove the click handler once audio is initialized
    if (audioContext.state === 'running') {
        document.removeEventListener('click', initAudioContext);
    }
}, { once: false });

// Add CSS styles for overlapping clips
const style = document.createElement('style');
style.textContent = `
    .timeline-track {
        position: relative;
        height: 100px;
        margin: 10px 0;
        background: #f8ffe5;
    }
    
    .track-content {
        position: relative;
        height: 100%;
    }
    
    .timeline-clip {
        position: absolute;
        height: 80px;
        top: 10px;
        background: #4CAF50;
        border-radius: 4px;
        cursor: move;
        z-index: 1;
    }
    
    .timeline-clip.dialogue {
        background: #2196F3;
    }
    
    .timeline-clip.dragging {
        opacity: 0.7;
        z-index: 1000;
    }
    
    .clip-content {
        padding: 5px;
        color: white;
        font-size: 12px;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
    }
    
    .remove-clip {
        position: absolute;
        top: 2px;
        right: 2px;
        background: none;
        border: none;
        color: white;
        cursor: pointer;
    }

    /* Add styles for buttons */
    button {
        background-color: #f8ffe5;
        border: 1px solid #ddd;
        border-radius: 4px;
        padding: 5px 10px;
        cursor: pointer;
        transition: background-color 0.2s;
    }

    button:hover {
        background-color: #e8efd5;
    }

    button.recording {
        background-color: #f8ffe5;
        border-color: #4CAF50;
    }

    .controls button {
        background-color: #f8ffe5;
        margin: 0 2px;
    }

    .sound-item .controls button {
        background-color: #f8ffe5;
    }

    .timeline-controls button {
        background-color: #f8ffe5;
    }

    /* Styles for the three main mode buttons */
    #micButton, #ttsButton, #timelineButton {
        background-color: #f8ffe5;
        border: 1px solid #ddd;
        padding: 10px 20px;
        margin: 0 5px;
        font-size: 16px;
        font-weight: bold;
    }

    #micButton:hover, #ttsButton:hover, #timelineButton:hover {
        background-color: #e8efd5;
    }

    #micButton.recording, #ttsButton.recording, #timelineButton.recording {
        background-color: #f8ffe5;
        border-color: #4CAF50;
        box-shadow: 0 0 5px rgba(76, 175, 80, 0.5);
    }
`;
document.head.appendChild(style);

// Function to remove a clip from the timeline
function removeClip(trackId, clipId) {
    const track = timelineTracks.find(t => t.id === trackId);
    if (track) {
        const clipIndex = track.clips.findIndex(c => c.id === clipId);
        if (clipIndex !== -1) {
            track.clips.splice(clipIndex, 1);
            displayTimeline();
            saveProject();
        }
    }
}

// Add new function to add items to timeline at specific time
function addToTimelineAtTime(type, itemId, startTime) {
    console.log('Adding to timeline:', { type, itemId, startTime });
    const item = soundLibrary[type].find(i => i.id === itemId);
    if (!item) {
        console.error('Item not found in library:', type, itemId);
        speak('Error: Item not found', null, null, true);
        return;
    }
    
    let duration;
    if (type === 'dialogue') {
        duration = estimateDialogueDuration(item.text, item.tone);
    } else {
        duration = item.duration || 2;
    }
    
    // Add to the first track
    if (timelineTracks.length === 0) addNewTrack();
    
    const newClip = {
        id: Date.now(),
        type: type,
        sourceId: item.id,
        name: item.displayName,
        duration: duration,
        startTime: startTime,
        hasStarted: false
    };
    
    console.log('Created new clip:', newClip);
    timelineTracks[0].clips.push(newClip);
    
    displayTimeline();
    saveProject();
    
    const timeStr = formatTime(startTime);
    speak(`Added ${type === 'sfx' ? 'sound' : 'dialogue'} to timeline at ${timeStr}`, null, null, true);
}

// Helper function to get available library items
function getAvailableLibraryItems() {
    const sfxItems = soundLibrary.sfx.map(item => item.refId).join(', ');
    const dialogueItems = soundLibrary.dialogue.map(item => item.refId).join(', ');
    let message = '';
    if (sfxItems) message += `Sounds: ${sfxItems}`;
    if (dialogueItems) {
        if (message) message += ' and ';
        message += `Dialogue: ${dialogueItems}`;
    }
    return message || 'No items in library';
}

// Helper function to normalize references
function normalizeReference(ref) {
    // Convert word numbers to digits
    const wordToNumber = {
        'one': '1', 'two': '2', 'three': '3', 'four': '4', 'five': '5',
        'six': '6', 'seven': '7', 'eight': '8', 'nine': '9', 'ten': '10'
    };

    // Normalize the reference
    ref = ref.toLowerCase().trim();
    
    // If it's a word number, convert it
    if (wordToNumber[ref]) {
        return wordToNumber[ref];
    }
    
    // If it's a single letter, capitalize it
    if (ref.length === 1 && /[a-z]/i.test(ref)) {
        return ref.toUpperCase();
    }
    
    // If it's a number, return it as is
    if (/^\d+$/.test(ref)) {
        return ref;
    }
    
    // If it's a letter followed by a number (like "a1"), return just the letter
    if (/^[a-z]\d+$/i.test(ref)) {
        return ref[0].toUpperCase();
    }
    
    return null; // Return null for unrecognized formats
} 
