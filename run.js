const fs = require('fs');
const JSON = require('JSON');
const path = require('path');
const http = require('http');
const bodyParser = require('body-parser')
var express = require('express');
var app = express();

const dbFile = "./database.json";
var db = JSON.parse(fs.readFileSync(dbFile, "utf8"));

var config = {
	dev: true, // режим разработчика. логирование запросов с vk-callback
	deleteOldMsg: 60*60*24*35, // время, через которое сообщения с "базы" будут удалены (35 дней)
	port: 4444, // порт, на котором будет развернут callback сервер
	vk: {
		confirmation: "", // ключ подтверждения
		secret: "", // секретный клюс
	}
};

app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(bodyParser.json());

app.get('/admin', function(req, res) {
	// избавление от лишних файлов)))))))
	var html = fs.readFileSync(path.join(__dirname, '/index.html'), "utf8");
	res.send(html);
});

app.post('/admin/ajax/:type', function(req, res) {
	switch(req.params.type) {
		case "get": {
			// поиск агента в базе
			if(req.body.agent != 0 && !(req.body.agent in db.agents)) {
				res.json({
					status: false,
					msg: "Агент не найден"
				});
				return;
			}
			
			var stats = {};
			
			// выборка агентов с базы
			for(var agent in db.agents) {
				if(req.body.agent != 0 && req.body.agent != agent) continue;
				if(!(agent in stats)) stats[agent] = { all: db.agents[agent].all, send: 0, unique: 0 };
				var buffer = [];
				
				// выборка сообщений агентов с базы
				for(var i in db.agents[agent].msgs) {
					// проверка сообщений по заданному периоду времени
					if(db.agents[agent].msgs[i].time + 60 * req.body.min < new Date().getTime() / 1000) continue;
					stats[agent].send++;
					
					// проверяем на уникальность ответа агента. 
					// если в массиве buffer нет юзера, которому ответили, добавляем в статистику к ключу уникальность +1 и добавляем в массив buffer юзера, чтобы при следующей итерации не проверять его
					if(buffer.indexOf(db.agents[agent].msgs[i].peer_id) == -1) {
						stats[agent].unique++;
						buffer.push(db.agents[agent].msgs[i].peer_id);
					}
				}
			}
			
			res.json({
				status: true,
				msg: "Данные загружены",
				response: stats,
			});
			break;
		}
		default: {
			res.json({
				status: false,
				msg: "Method not found"
			});
		}
	}
});

app.post('/callback', function(req, res) {
	if(config.dev) console.log(req.body);
	
	var r = onHook(req.body) || "ok";
	res.send(r);
});

app.listen(config.vk.port, function(err) {
	if(err) return console.log("something bad happened", err);
	console.log("server start port: " + config.vk.port);
});

function onHook(data) {
	if(data.secret != config.vk.secret) return;
	if(data.type == "confirmation") return config.vk.confirmation;
	else if(data.type == "message_reply") {
		// если агента нет в базе, добавляем
		if(!(data.object.from_id in db.agents)) db.agents[data.object.from_id] = { all: 0, msgs: []};
		
		db.agents[data.object.from_id].all++;
		db.agents[data.object.from_id].msgs.push({
			time: data.object.date,
			peer_id: data.object.peer_id,
		});
		
		updateDB();
	}
}

// Раз в час будут проверяться и удаляться старые сообщения с базы
setInterval(function() {
	for(var agent in db.agents) {
		for(var i in db.agents[agent].msgs) {
			if(db.agents[agent].msgs[i].time + config.deleteOldMsg < new Date().getTime() / 1000) db.agents[agent].msgs.splice(db.agents[agent].msgs.indexOf(i) ,1);
		}
	}
}, 60*60 * 1000);

// Запись данных раз в 60 секунд в файл (обновление базы)
setInterval(function() {
	updateDB();
}, 60 * 1000);

// Функция преобразует объект db в JSON и сохраняет в файл
function updateDB() {
	fs.writeFileSync(dbFile, JSON.stringify(db), 'utf8');
}
