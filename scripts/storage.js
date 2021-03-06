function getDatabase() {
	return new Promise((resolve, reject) => {
		let dbOpenRequest = window.indexedDB.open("headereditor", 2);
		dbOpenRequest.onsuccess = function(e) {
			resolve(e.target.result);
		};
		dbOpenRequest.onerror = function(event) {
			console.log(event);
			reject(event);
		};
		dbOpenRequest.onupgradeneeded = function(event) {
			if (event.oldVersion == 0) {
				// Installed
				for (let t of tableNames) {
					event.target.result.createObjectStore(t, {keyPath: 'id', autoIncrement: true});
				}
			} else {
				if (event.oldVersion < 2) {
					upgradeTo2();
				}
			}
		}
	});
};

function runTryCatch(func) {
	try {
		return func();
	} catch(e) {}
}

var cachedRules = {};
for (let t of tableNames) {
	cachedRules[t] = null;
}
function getRules(type, options) {
	return options ? filterRules(cachedRules[type], options) : cachedRules[type];
}

function updateCache(type) {
	getDatabase().then((db) => {
		var tx = db.transaction([type], "readonly");
		var os = tx.objectStore(type);
		var all = [];
		os.openCursor().onsuccess = function(event) {
			var cursor = event.target.result;
			if (cursor) {
				let s = cursor.value;
				let isValidRule = true;
				s.id = cursor.key;
				// Init function here
				if (s.isFunction) {
					try {
						s._func = new Function('val', 'detail', s.code);
					} catch (e) {
						isValidRule = false;
					}
				}
				// Init regexp
				if (s.matchType === 'regexp') {
					try {
						s._reg = new RegExp(s.pattern);
					} catch (e) {
						isValidRule = false;
					}
				}
				if (typeof(s.exclude) === 'string' && s.exclude.length > 0) {
					try {
						s._exclude = new RegExp(s.exclude);
					} catch (e) {
						isValidRule = false;
					}
				}
				if (isValidRule) {
					all.push(s);
				}
				cursor.continue();
			} else {
				cachedRules[type] = all;
			}
		};
	});
}

function filterRules(rules, options) {
	if (options === null || typeof(options) !== 'object') {
		return rules;
	}
	var url = typeof(options.url) !== 'undefined' ? options.url: null;
	var id = typeof(options.id) !== 'undefined' ? Number(options.id) : null;

	if (id != null) {
		rules = rules.filter((rule) => {
			return rule.id == id;
		});
	}

	if (options.name) {
		rules = rules.filter((rule) => {
			return rule.name === options.name;
		});
	}

	if (typeof(options.enable) !== 'undefined') {
		rules = rules.filter((rule) => {
			return rule.enable == options.enable;
		});
	}

	if (url != null) {
		rules = rules.filter((rule) => {
			let result = false;
			switch (rule.matchType) {
				case 'all':
					result = true;
					break;
				case 'regexp':
					result = rule._reg.test(url);
					break;
				case 'prefix':
					result = url.indexOf(rule.pattern) === 0;
					break;
				case 'domain':
					result = getDomain(url) === rule.pattern;
					break;
				case 'url':
					result = url === rule.pattern;
					break;
				default:
					break;
			}
			if (result && rule._exclude) {
				return !(rule._exclude.test(url));
			} else {
				return result;
			}
		});
	}
	return rules;
}

function saveRule(tableName, o) {
	return new Promise((resolve) => {
		getDatabase().then((db) => {
			var tx = db.transaction([tableName], "readwrite");
			var os = tx.objectStore(tableName);
			// Update
			if (o.id) {
				var request = os.get(Number(o.id));
				request.onsuccess = function(event) {
					var rule = request.result || {};
					for (var prop in o) {
						if (prop == "id") {
							continue;
						}
						rule[prop] = o[prop];
					}
					request = os.put(rule);
					request.onsuccess = function(event) {
						updateCache(tableName);
						resolve(rule);
					};
				};
				return;
			}
			// Create
			// Make sure it's not null - that makes indexeddb sad
			delete o["id"];
			var request = os.add(o);
			request.onsuccess = function(event) {
				updateCache(tableName);
				// Give it the ID that was generated
				o.id = event.target.result;
				resolve(o);
			};
		});
	});
}

function deleteRule(tableName, id) {
	return new Promise((resolve) => {
		getDatabase().then((db) => {
			var tx = db.transaction([tableName], "readwrite");
			var os = tx.objectStore(tableName);
			var request = os.delete(Number(id));
			request.onsuccess = function(event) {
				updateCache(tableName);
				resolve();
			};
		});
	});
}

function getDomain(url) {
	if (url.indexOf("file:") == 0) {
		return '';
	}
	var d = /.*?:\/*([^\/:]+)/.exec(url)[1];
	return d;
}

function getType(o) {
	if (typeof o == "undefined" || typeof o == "string") {
		return typeof o;
	}
	if (o instanceof Array) {
		return "array";
	}
	throw "Not supported - " + o;
}


function upgradeTo2() {
	for (let k of tableNames) {
		getDatabase().then((db) => {
			let tx = db.transaction([k], "readwrite");
			let os = tx.objectStore(k);
			os.openCursor().onsuccess = function(e) {
				let cursor = e.target.result;
				if (cursor) {
					let s = cursor.value;
					s.id = cursor.key;
					s.matchType = s.type;
					delete s.type;
					s.isFunction = 0;
					s.enable = 1;
					os.put(s);
					cursor.continue();
				} else {
					updateCache(k);
				}
			};
		});
	}
}

function initStorage() {
	setTimeout(() => {
		updateCache('request');
		updateCache('sendHeader');
		updateCache('receiveHeader');
		if (cachedRules.request === null || cachedRules.sendHeader === null || cachedRules.receiveHeader === null) {
			initStorage();
		}
	}, 50);
}
initStorage();