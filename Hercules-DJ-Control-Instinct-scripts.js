// http://ts.hercules.com/download/sound/manuals/DJ_Instinct/QSG/DJCInstinct_Technical_specifications.pdf

// === BUTTON MAP ===

const BUTTONS = {

	"[Channel1]": {
		effect1:	0x01, effect2:	0x02, effect3:	0x03, effect4:	0x04, // LEDs
		sample1:	0x05, sample2:	0x06, sample3:	0x07, sample4:	0x08, // LEDs
		loop1:		0x09, loop2:	0x0A, loop3:	0x0B, loop4:	0x0C, // LEDs
		cue1:		0x0D, cue2:		0x0E, cue3:		0x0F, cue4:		0x10, // LEDs
		"pitch-":	0x11, "pitch+":	0x12, back:		0x13, forward:	0x14, // no LEDs
		cue:		0x15, play:		0x16, sync:		0x17, head:		0x18, // LEDs
		load:		0x19, touch:	0x1A // no LEDs
	},

	"[Channel2]": {
		effect1:	0x1B, effect2:	0x1C, effect3:	0x1D, effect4:	0x1E, // LEDs
		sample1:	0x1F, sample2:	0x20, sample3:	0x21, sample4:	0x22, // LEDs
		loop1:		0x23, loop2:	0x24, loop3:	0x25, loop4:	0x26, // LEDs
		cue1:		0x27, cue2:		0x28, cue3:		0x29, cue4:		0x2A, // LEDs
		"pitch-":	0x2B, "pitch+":	0x2C, back:		0x2D, forward:	0x2E, // no LEDs
		cue:		0x2F, play:		0x30, sync:		0x31, head:		0x32, // LEDs
		load:		0x33, touch:	0x34 // no LEDs
	},

	vinyl:	0x35, // LED
	up:		0x36, down:		0x37, // no LEDs
	file:	0x38, folder:	0x39, // LEDs
	"gain-":0x40, "gain+":	0x41 // no LEDs

};


// === GENERAL HELPERS ===

// Extract all numeric chars from a string
// Used to convert channel names to deck numbers
var nums = function(str) {

	return str.replace(/\D/g, "");

};


// === LED HELPERS ===

// Control a single LED
var setLed = function(button, state) {

	// Send MIDI signal to enable/disable LED
	midi.sendShortMsg(state ? 0x90 : 0x80, button, state ? 0x7F : 0x00);

};

// Control all LEDs in an object/array, recursively.
var setAllLEDsIn = function(data, state) {

	for (var index in data) {
		var subData = data[index];
		var type = typeof subData;

		if (type == "object") { // recurse, if another object/array

			setAllLEDsIn(subData, state);

		} else if (type == "number" && subData >= 0x00 && subData <= 0x7F) { // set state if valid MIDI number

			setLed(subData, state);

		};

	};

};


// === CORE ===

var HCI = {};

// constructor (called when the MIDI device is opened & set up)
HCI.init = function(id, debugging) {

	// Remember id
	HCI.id = id;

	// Cleanup LEDs states
	setAllLEDsIn(BUTTONS, false);

	// set global defaults
	HCI.shift = false;
	HCI.pitchButtons = [null, [0, 0], [0, 0]];
	HCI.timerPlaylist = null;
	HCI.timerFirstTick = false;
	HCI.wheelPressed = false;

	HCI.setInFileBrowser(true);

	print("***** Hercules DJ Instinct Control id: \"" + HCI.id + "\" initialized.");

};

// destructor (Called when the MIDI device is closed)
HCI.shutdown = function() {

	// Cleanup LEDs states
	setAllLEDsIn(BUTTONS, false);

	print("***** Hercules DJ Instinct Control id: \"" + HCI.id + "\" shut down.");

};


// === SHIFT TOGGLE ===

HCI.vinylButtonHandler = function(midiNo, control, value, status, group) {

	var state = (value == ButtonState.pressed); // pressed or released

	// save state
	HCI.shift = state;

	// turn LED on/off
	setLed(control, state);

};


// === JOG WHEELS ===

HCI.wheelTouch = function(midiNo, control, value, status, group) {

	HCI.wheelPressed = value == ButtonState.pressed; // pressed

	if (HCI.wheelPressed) {

		if (!HCI.shift) {

			// enable scratching
			var alpha = 1.0 / 8;
			var beta = alpha / 32;
			engine.scratchEnable(nums(group), 128, 33 + 1 / 3, alpha, beta);

		};

	} else { // released

		// disable scratching
		engine.scratchDisable(nums(group));

		// reset quick filter
		engine.setValue("[QuickEffectRack1_" + group + "]", "super1", 0.5);

	};

};

HCI.wheelTurn = function(midiNo, control, value, status, group) {

	// normalize value (-1 or 1)
	var direction = value;
	if (value - 64 > 0) {
		direction = value - 128;
	};

	if (!HCI.shift) {

		// check if scratching (wheelTouch toggle)
		if (engine.isScratching(nums(group))) {

			// scratch
			engine.scratchTick(nums(group), direction);

		} else {

			// pitch bend
			engine.setValue(group, "jog", direction);

		};

	} else {

		if (HCI.wheelPressed) {

			var filterValue = engine.getValue("[QuickEffectRack1_" + group + "]", "super1");
			engine.setValue("[QuickEffectRack1_" + group + "]", "super1", filterValue + direction / 100);

		};

	};

};


// === PITCH ===

// +/- Buttons
HCI.pitch = function(midiNo, control, value, status, group) {

	// get pressed buttons data
	var button = (control == BUTTONS[group]["pitch-"]); // - or + button ?
	var state = (value == ButtonState.pressed) ? 1 : 0; // pressed or released ?
	var speed = (HCI.shift) ? "" : "_small"; // shift increases step size

	// remember state
	HCI.pitchButtons[nums(group)][button ? 0 : 1] = state;

	// apply temp pitch
	engine.setValue(group, "rate_temp_" + (button ? "down" : "up") + speed, state);

	// when buttons - and + are pressed simultaneously
	if (HCI.pitchButtons[nums(group)][0] && HCI.pitchButtons[nums(group)][1]) {
		// reset pitch to 0
		engine.setValue(group, "rate", 0);
	};

};

// Up/Down-Switches
HCI.permPitch = function(midiNo, control, value, status, group) {

	// get pressed buttons data
	var rate = (value == ButtonState.pressed) ? "rate_perm_up" : "rate_perm_down"; // up or down push ?
	var speed = (HCI.shift) ? "" : "_small"; // shift increases step size

	// tick
	engine.setValue(group, rate + speed, true);

};


// === FILE BROWSER ===

HCI.setInFileBrowser = function(state) {

	// remember state
	HCI.inFileBrowser = state;

	// set LED states
	setLed(BUTTONS.folder, !state);
	setLed(BUTTONS.file, state);

};

HCI.PlaylistModeFolder = function(midiNo, control, value, status, group) {

	// don't do anything when button is released
	if (value != ButtonState.pressed) return;

	// check browser mode
	if (!HCI.inFileBrowser) { // folder button while in folder mode already

		// expand/collapse selected folder
		engine.setValue(group, "ToggleSelectedSidebarItem", true);

	} else { // folder button while in file mode

		// switch to folder list
		HCI.setInFileBrowser(false);

	};

};

HCI.PlaylistModeFile = function(midiNo, control, value, status, group) {

	// don't do anything when button is released
	if (value != ButtonState.pressed) return;

	// check browser mode
	if (HCI.inFileBrowser) { // file button while in file mode already

		// load selected track to free deck
		engine.setValue(group, "LoadSelectedIntoFirstStopped", true);

	} else { // file button while in folder mode

		// switch to file mode
		HCI.setInFileBrowser(true);

	};

};

HCI.PlaylistPrev = function(midiNo, control, value, status, group) {

	if (value == ButtonState.pressed) { // pressed

		// check browser mode
		if (HCI.inFileBrowser) {

			// create and start repeat-timer, if there is none yet
			if (HCI.timerPlaylist == null) {
				HCI.timerPlaylist = engine.beginTimer(500, "HCI.PlaylistPrev(" + midiNo + ", " + control + ", " + value + ", " + status + ", '" + group + "')", true);
				HCI.timerFirstTick = true;
			} else if (HCI.timerFirstTick) {
				HCI.timerPlaylist = engine.beginTimer(50, "HCI.PlaylistPrev(" + midiNo + ", " + control + ", " + value + ", " + status + ", '" + group + "')", false);
				HCI.timerFirstTick = false;
			};

			// select previous file
			engine.setValue(group, "SelectPrevTrack", true);

		} else {

			// select previous folder
			engine.setValue(group, "SelectPrevPlaylist", true);

		};

	} else { // released

		// stop and destroy repeat-timer, if there is one left
		if (HCI.timerPlaylist != null) {
			engine.stopTimer(HCI.timerPlaylist);
			HCI.timerPlaylist = null;
		};

	};

};

HCI.PlaylistNext = function(midiNo, control, value, status, group) {

	if (value == ButtonState.pressed) { // pressed

		// check browser mode
		if (HCI.inFileBrowser) {

			// create and start repeat-timer, if there is none yet
			if (HCI.timerPlaylist == null) {
				HCI.timerPlaylist = engine.beginTimer(500, "HCI.PlaylistNext(" + midiNo + ", " + control + ", " + value + ", " + status + ", '" + group + "')", true);
				HCI.timerFirstTick = true;
			} else if (HCI.timerFirstTick) {
				HCI.timerPlaylist = engine.beginTimer(50, "HCI.PlaylistNext(" + midiNo + ", " + control + ", " + value + ", " + status + ", '" + group + "')", false);
				HCI.timerFirstTick = false;
			};

			// select next file
			engine.setValue(group, "SelectNextTrack", true);

		} else {

			// select next folder
			engine.setValue(group, "SelectNextPlaylist", true);

		};

	} else { // released

		// stop and destroy repeat-timer, if there is one left
		if (HCI.timerPlaylist != null) {
			engine.stopTimer(HCI.timerPlaylist);
			HCI.timerPlaylist = null;
		};

	};

};


// === HOT CUES ===

HCI.hotCue = function(midiNo, control, value, status, group) {

	// don't do anything when button is released
	if (value != ButtonState.pressed) return;

	// get the pressed button number (1-4)
	var cue = 1; // assume 1, but check for 2-4 after
	for (var i = 2; i <= 4; i++) {
		if (control == BUTTONS[group]["cue" + i]) {
			cue = i;
			break;
		};
	};

	// shift deletes cue points
	var action = "hotcue_" + cue + "_" + (HCI.shift ? "clear" : "activate");

	// set / skip to / delete hot cue
	engine.setValue(group, action, true);

};
