// ==UserScript==
// @name         [DVI] 捡漏 + 自动练级
// @name:zh-CN   [DVI] 捡漏 + 自动练级
// @namespace    local.dvi.profit
// @version      0.1.1
// @description  按“利润/小时”筛选采集与制造作业，一键自动挂机、补料、上架；另有快速升级tab，按金币/时间比值规划最省钱路线。
// @description:en Pick gathering/crafting jobs by profit per hour, auto-run them, and plan the cheapest skill levelling route.
// @author       clmodos
// @match        https://deepveinidle.com/*
// @match        https://www.deepveinidle.com/*
// @match        https://cn.deepveinidle.com/*
// @run-at       document-idle
// @grant        none
// @sandbox      raw
// @inject-into  page
// @noframes
// @license      MIT
// @updateURL    https://raw.githubusercontent.com/clmodos/git-learn-yjl/master/dvi-userscripts/dvi-profit.meta.js
// @downloadURL  https://raw.githubusercontent.com/clmodos/git-learn-yjl/master/dvi-userscripts/dvi-profit.user.js
// ==/UserScript==
/*
 * 数据来源：
 *  - 作业/物品/站点：游戏自身 bundle 的静态表（build/build-data.js 在构建期抽取成快照）
 *  - 市场价：https://deepveinidle.com/api/market/prices.json（官方每 5 分钟重建）
 *  - 玩家状态：window.deepvein.session.state
 * 协议（游戏自己的消息）：
 *  setRoute 开始挂机 / skip 停止 / marketSell 卖出 / marketBuy 买入
 */
(() => {
'use strict';
/* ===== data.snapshot.js ===== */
// 自动生成，勿手改：node build/build-data.js
const SNAPSHOT_VERSION = '2026-11-15T08:28:57';
const JOB_ROWS = [[1,"Copper","mining","Ore",1,5,2,[],1,1,0,0,0,0,0,1],[2,"Tin","mining","Ore",1,5,3,[],2,1,0,0,0,0,0,2],[3,"Iron","mining","Ore",15,6,5,[],3,1,100,0.0005,0,0,0,7],[4,"Silver","mining","Ore",30,7,9,[],4,1,100,0.001,0,0,0,10],[5,"Coal","mining","Ore",40,8,14,[],5,1,100,0.001,0,0,0,13],[344,"Pure coal","mining","Ore",40,8,14,[],5,1,100,0.001,0,0,1,395],[6,"Gold","mining","Ore",55,9,22,[],6,1,100,0.002,0,0,0,16],[7,"Cobalt","mining","Ore",65,11,37,[],7,1,100,0.003,0,0,0,19],[8,"Meteoric","mining","Ore",85,13,59,[],8,1,100,0.005,0,0,0,22],[21,"Shrimp","fishing","Fish",1,5,2,[],20,1,0,0,0,0,0,25],[22,"Sardine","fishing","Fish",5,5,3,[],21,1,0,0,0,0,0,27],[23,"Trout","fishing","Fish",20,6,7,[],22,1,0,0,0,0,0,29],[24,"Salmon","fishing","Fish",30,7,11,[],23,1,0,0,0,0,0,31],[25,"Tuna","fishing","Fish",45,8,17,[],24,1,0,0,0,0,0,33],[26,"Lobster","fishing","Fish",60,10,28,[],25,1,0,0,0,0,0,35],[27,"Swordfish","fishing","Fish",75,11,44,[],26,1,0,0,0,0,0,37],[28,"Shark","fishing","Fish",90,13,60,[],27,1,0,0,0,0,0,39],[30,"Tree","woodcutting","Wood",1,5,3,[],10,1,160,0.0125,0,0,0,56],[31,"Oak","woodcutting","Wood",15,6,7,[],11,1,161,0.008333333333333333,0,0,0,59],[32,"Willow","woodcutting","Wood",30,7,11,[],12,1,162,0.005555555555555556,0,0,0,62],[33,"Maple","woodcutting","Wood",45,8,18,[],13,1,163,0.0038461538461538464,0,0,0,65],[34,"Yew","woodcutting","Wood",60,10,29,[],14,1,164,0.002777777777777778,0,0,0,68],[35,"Magic","woodcutting","Wood",75,12,48,[],15,1,165,0.0022222222222222222,0,0,0,71],[160,"Potato","farming","Crops",1,2,110,[[160,1]],170,1,0,0,1,0,0,74],[161,"Glowcap","farming","Crops",15,2,380,[[161,1]],171,1,0,0,1,0,0,74],[162,"Cave turnip","farming","Crops",30,2,900,[[162,1]],172,1,0,0,1,0,0,74],[163,"Bitterroot","farming","Crops",45,2,1900,[[163,1]],173,1,0,0,1,0,0,74],[164,"Voidmelon","farming","Crops",60,2,3800,[[164,1]],174,1,0,0,1,0,0,74],[165,"Ember pepper","farming","Crops",75,2,6500,[[165,1]],175,1,0,0,1,0,0,74],[41,"Bronze bar","smithing","Bars",1,4,6,[[1,1],[2,1]],40,1,0,0,0,0,0,42],[42,"Iron bar","smithing","Bars",15,4,8,[[3,1]],41,1,0,0,0,0,0,42],[43,"Steel bar","smithing","Bars",30,4,35,[[3,1],[5,2]],42,1,0,0,0,0,0,42],[44,"Cobalt bar","smithing","Bars",60,4,108,[[7,1],[5,3]],43,1,0,0,0,0,0,42],[45,"Meteoric bar","smithing","Bars",85,4,253,[[8,1],[5,4]],44,1,0,0,0,0,0,42],[51,"Bronze pickaxe","smithing","Pickaxes",1,5,17,[[40,2]],80,1,0,0,0,0,0,43],[52,"Iron pickaxe","smithing","Pickaxes",15,5,27,[[41,2]],81,1,0,0,0,0,0,43],[53,"Steel pickaxe","smithing","Pickaxes",30,5,83,[[42,2]],82,1,0,0,0,0,0,43],[54,"Cobalt pickaxe","smithing","Pickaxes",60,5,240,[[43,2]],83,1,0,0,0,0,0,43],[55,"Meteoric pickaxe","smithing","Pickaxes",85,5,552,[[44,2]],84,1,0,0,0,0,0,43],[56,"Bronze rod","fletching","Rods",1,5,8,[[40,1],[10,1]],85,1,0,0,0,0,0,43],[57,"Iron rod","fletching","Rods",15,5,13,[[41,1],[11,1]],86,1,0,0,0,0,0,43],[58,"Steel rod","fletching","Rods",30,5,41,[[42,1],[12,1]],87,1,0,0,0,0,0,43],[59,"Cobalt rod","fletching","Rods",60,5,120,[[43,1],[14,1]],88,1,0,0,0,0,0,43],[60,"Meteoric rod","fletching","Rods",85,5,276,[[44,1],[15,1]],89,1,0,0,0,0,0,43],[308,"Bronze pan","smithing","Pans",1,5,8,[[40,1]],360,1,0,0,0,0,0,43],[309,"Iron pan","smithing","Pans",15,5,13,[[41,1]],361,1,0,0,0,0,0,43],[310,"Steel pan","smithing","Pans",30,5,41,[[42,1]],362,1,0,0,0,0,0,43],[311,"Cobalt pan","smithing","Pans",60,5,120,[[43,1]],363,1,0,0,0,0,0,43],[312,"Meteoric pan","smithing","Pans",85,5,276,[[44,1]],364,1,0,0,0,0,0,43],[313,"Bronze hammer","smithing","Hammers",1,5,17,[[40,2]],365,1,0,0,0,0,0,43],[314,"Iron hammer","smithing","Hammers",15,5,27,[[41,2]],366,1,0,0,0,0,0,43],[315,"Steel hammer","smithing","Hammers",30,5,83,[[42,2]],367,1,0,0,0,0,0,43],[316,"Cobalt hammer","smithing","Hammers",60,5,240,[[43,2]],368,1,0,0,0,0,0,43],[317,"Meteoric hammer","smithing","Hammers",85,5,552,[[44,2]],369,1,0,0,0,0,0,43],[318,"Bronze knife","smithing","Knives",1,5,8,[[40,1]],370,1,0,0,0,0,0,43],[319,"Iron knife","smithing","Knives",15,5,13,[[41,1]],371,1,0,0,0,0,0,43],[320,"Steel knife","smithing","Knives",30,5,41,[[42,1]],372,1,0,0,0,0,0,43],[321,"Cobalt knife","smithing","Knives",60,5,120,[[43,1]],373,1,0,0,0,0,0,43],[322,"Meteoric knife","smithing","Knives",85,5,276,[[44,1]],374,1,0,0,0,0,0,43],[323,"Bronze needle","crafting","Needles",1,5,8,[[40,1]],375,1,0,0,0,0,0,43],[324,"Iron needle","crafting","Needles",15,5,13,[[41,1]],376,1,0,0,0,0,0,43],[325,"Steel needle","crafting","Needles",30,5,41,[[42,1]],377,1,0,0,0,0,0,43],[326,"Cobalt needle","crafting","Needles",60,5,120,[[43,1]],378,1,0,0,0,0,0,43],[327,"Meteoric needle","crafting","Needles",85,5,276,[[44,1]],379,1,0,0,0,0,0,43],[328,"Bronze mortar","crafting","Mortars",1,5,17,[[40,2]],380,1,0,0,0,0,0,43],[329,"Iron mortar","crafting","Mortars",15,5,27,[[41,2]],381,1,0,0,0,0,0,43],[330,"Steel mortar","crafting","Mortars",30,5,83,[[42,2]],382,1,0,0,0,0,0,43],[331,"Cobalt mortar","crafting","Mortars",60,5,240,[[43,2]],383,1,0,0,0,0,0,43],[332,"Meteoric mortar","crafting","Mortars",85,5,552,[[44,2]],384,1,0,0,0,0,0,43],[600,"Bronze flask","crafting","Flasks",1,6,33,[[40,2],[180,1]],770,1,0,0,0,0,0,43],[601,"Iron flask","crafting","Flasks",15,6,43,[[41,2],[180,1]],771,1,0,0,0,0,0,43],[602,"Steel flask","crafting","Flasks",30,6,99,[[42,2],[180,1]],772,1,0,0,0,0,0,43],[603,"Cobalt flask","crafting","Flasks",60,6,256,[[43,2],[180,1]],773,1,0,0,0,0,0,43],[604,"Meteoric flask","crafting","Flasks",85,6,568,[[44,2],[180,1]],774,1,0,0,0,0,0,43],[333,"Bronze hoe","fletching","Hoes",1,5,17,[[40,1],[10,2]],385,1,0,0,0,0,0,43],[334,"Iron hoe","fletching","Hoes",15,5,27,[[41,1],[11,2]],386,1,0,0,0,0,0,43],[335,"Steel hoe","fletching","Hoes",30,5,83,[[42,1],[12,2]],387,1,0,0,0,0,0,43],[336,"Cobalt hoe","fletching","Hoes",60,5,240,[[43,1],[14,2]],388,1,0,0,0,0,0,43],[337,"Meteoric hoe","fletching","Hoes",85,5,552,[[44,1],[15,2]],389,1,0,0,0,0,0,43],[46,"Bronze axe","smithing","Axes",1,5,17,[[40,2]],90,1,0,0,0,0,0,43],[47,"Iron axe","smithing","Axes",15,5,27,[[41,2]],91,1,0,0,0,0,0,43],[48,"Steel axe","smithing","Axes",30,5,83,[[42,2]],92,1,0,0,0,0,0,43],[49,"Cobalt axe","smithing","Axes",60,5,240,[[43,2]],93,1,0,0,0,0,0,43],[50,"Meteoric axe","smithing","Axes",85,5,552,[[44,2]],94,1,0,0,0,0,0,43],[61,"Cook shrimp","cooking","Food",1,4,4,[[20,1]],60,1,0,0,0,0,0,44],[62,"Cook sardine","cooking","Food",5,4,5,[[21,1]],61,1,0,0,0,0,0,44],[63,"Cook trout","cooking","Food",20,4,10,[[22,1]],62,1,0,0,0,0,0,44],[64,"Cook salmon","cooking","Food",30,4,14,[[23,1]],63,1,0,0,0,0,0,44],[65,"Cook tuna","cooking","Food",45,4,22,[[24,1]],64,1,0,0,0,0,0,44],[66,"Cook lobster","cooking","Food",60,4,36,[[25,1]],65,1,0,0,0,0,0,44],[67,"Cook swordfish","cooking","Food",75,4,59,[[26,1]],66,1,0,0,0,0,0,44],[68,"Cook shark","cooking","Food",90,4,92,[[27,1]],67,1,0,0,0,0,0,44],[110,"Bronze blade","smithing","Weapons",1,5,8,[[40,1]],110,1,0,0,0,0,0,43],[111,"Iron blade","smithing","Weapons",15,5,13,[[41,1]],111,1,0,0,0,0,0,43],[112,"Steel blade","smithing","Weapons",30,5,41,[[42,1]],112,1,0,0,0,0,0,43],[113,"Cobalt blade","smithing","Weapons",60,5,120,[[43,1]],113,1,0,0,0,0,0,43],[114,"Meteoric blade","smithing","Weapons",85,5,276,[[44,1]],114,1,0,0,0,0,0,43],[338,"Bronze greatsword","smithing","Two-handers",1,5,17,[[40,2]],390,1,0,0,0,0,0,43],[339,"Iron greatsword","smithing","Two-handers",15,5,27,[[41,2]],391,1,0,0,0,0,0,43],[340,"Steel greatsword","smithing","Two-handers",30,5,83,[[42,2]],392,1,0,0,0,0,0,43],[341,"Cobalt greatsword","smithing","Two-handers",60,5,240,[[43,2]],393,1,0,0,0,0,0,43],[342,"Meteoric greatsword","smithing","Two-handers",85,5,552,[[44,2]],394,1,0,0,0,0,0,43],[115,"Bronze shield","smithing","Shields",1,5,25,[[40,3]],115,1,0,0,0,0,0,43],[116,"Iron shield","smithing","Shields",15,5,40,[[41,3]],116,1,0,0,0,0,0,43],[117,"Steel shield","smithing","Shields",30,5,124,[[42,3]],117,1,0,0,0,0,0,43],[118,"Cobalt shield","smithing","Shields",60,5,360,[[43,3]],118,1,0,0,0,0,0,43],[119,"Meteoric shield","smithing","Shields",85,5,828,[[44,3]],119,1,0,0,0,0,0,43],[120,"Bronze helm","smithing","Helmets",1,5,17,[[40,2]],120,1,0,0,0,0,0,43],[121,"Iron helm","smithing","Helmets",15,5,27,[[41,2]],121,1,0,0,0,0,0,43],[122,"Steel helm","smithing","Helmets",30,5,83,[[42,2]],122,1,0,0,0,0,0,43],[123,"Cobalt helm","smithing","Helmets",60,5,240,[[43,2]],123,1,0,0,0,0,0,43],[124,"Meteoric helm","smithing","Helmets",85,5,552,[[44,2]],124,1,0,0,0,0,0,43],[125,"Bronze plate","smithing","Bodies",1,5,42,[[40,5]],125,1,0,0,0,0,0,43],[126,"Iron plate","smithing","Bodies",15,5,67,[[41,5]],126,1,0,0,0,0,0,43],[127,"Steel plate","smithing","Bodies",30,5,207,[[42,5]],127,1,0,0,0,0,0,43],[128,"Cobalt plate","smithing","Bodies",60,5,600,[[43,5]],128,1,0,0,0,0,0,43],[129,"Meteoric plate","smithing","Bodies",85,5,1380,[[44,5]],129,1,0,0,0,0,0,43],[130,"Bronze greaves","smithing","Legs",1,5,34,[[40,4]],130,1,0,0,0,0,0,43],[131,"Iron greaves","smithing","Legs",15,5,53,[[41,4]],131,1,0,0,0,0,0,43],[132,"Steel greaves","smithing","Legs",30,5,165,[[42,4]],132,1,0,0,0,0,0,43],[133,"Cobalt greaves","smithing","Legs",60,5,480,[[43,4]],133,1,0,0,0,0,0,43],[134,"Meteoric greaves","smithing","Legs",85,5,1104,[[44,4]],134,1,0,0,0,0,0,43],[140,"Shortbow","fletching","Shortbows",1,5,5,[[10,1]],140,1,0,0,0,0,0,43],[141,"Oak shortbow","fletching","Shortbows",15,5,11,[[11,1]],141,1,0,0,0,0,0,43],[142,"Willow shortbow","fletching","Shortbows",30,5,17,[[12,1]],142,1,0,0,0,0,0,43],[143,"Maple shortbow","fletching","Shortbows",45,5,27,[[13,1]],143,1,0,0,0,0,0,43],[144,"Yew shortbow","fletching","Shortbows",60,5,43,[[14,1]],144,1,0,0,0,0,0,43],[145,"Magic shortbow","fletching","Shortbows",75,5,70,[[15,1]],145,1,0,0,0,0,0,43],[146,"Longbow","fletching","Longbows",1,5,10,[[10,2]],146,1,0,0,0,0,0,43],[147,"Oak longbow","fletching","Longbows",15,5,22,[[11,2]],147,1,0,0,0,0,0,43],[148,"Willow longbow","fletching","Longbows",30,5,34,[[12,2]],148,1,0,0,0,0,0,43],[149,"Maple longbow","fletching","Longbows",45,5,54,[[13,2]],149,1,0,0,0,0,0,43],[150,"Yew longbow","fletching","Longbows",60,5,86,[[14,2]],150,1,0,0,0,0,0,43],[151,"Magic longbow","fletching","Longbows",75,5,140,[[15,2]],151,1,0,0,0,0,0,43],[200,"Staff","fletching","Staffs",1,5,8,[[10,2]],152,1,0,0,0,0,0,43],[201,"Oak staff","fletching","Staffs",15,5,22,[[11,2]],153,1,0,0,0,0,0,43],[202,"Willow staff","fletching","Staffs",30,5,40,[[12,2]],154,1,0,0,0,0,0,43],[203,"Maple staff","fletching","Staffs",45,5,65,[[13,2]],155,1,0,0,0,0,0,43],[204,"Yew staff","fletching","Staffs",60,5,100,[[14,2]],156,1,0,0,0,0,0,43],[205,"Magic staff","fletching","Staffs",75,5,150,[[15,2]],157,1,0,0,0,0,0,43],[210,"Sage","farming","Herbs",10,2,260,[[190,1]],193,1,0,0,1,0,0,74],[211,"Nightshade","farming","Herbs",35,2,1200,[[191,1]],194,1,0,0,1,0,0,74],[212,"Dragonleaf","farming","Herbs",65,2,4600,[[192,1]],195,1,0,0,1,0,0,74],[220,"Gatherer's draught","herblore","Potions",1,6,30,[[193,1],[240,1]],220,1,0,0,0,0,0,44],[225,"Swift draught","herblore","Potions",20,6,70,[[193,1],[242,1]],225,1,0,0,0,0,0,44],[226,"Nourishing draught","herblore","Potions",50,6,240,[[194,1],[244,1]],226,1,0,0,0,0,0,44],[227,"Haste draught","herblore","Potions",70,7,460,[[195,1],[245,1]],227,1,0,0,0,0,0,44],[221,"Hunter's brew","herblore","Potions",35,6,120,[[194,1],[243,1]],221,1,0,0,0,0,0,44],[222,"Warrior's tonic","herblore","Potions",60,6,300,[[195,1],[244,1]],222,1,0,0,0,0,0,44],[223,"Elixir of the vein","herblore","Potions",80,7,700,[[194,1],[195,1],[246,1]],223,1,0,0,0,0,0,44],[224,"Abyssal tonic","herblore","Potions",95,7,1600,[[195,1],[249,1]],224,1,0,0,0,0,0,44],[230,"Cut gem","crafting","Gems",1,5,16,[[100,1]],180,1,0,0,0,0,0,43],[231,"Silver ring","crafting","Rings",20,6,58,[[4,1],[180,1]],181,1,0,0,0,0,0,43],[232,"Gold ring","crafting","Rings",45,6,156,[[6,1],[180,1]],182,1,0,0,0,0,0,43],[233,"Meteoric ring","crafting","Rings",75,7,455,[[44,1],[180,2]],183,1,0,0,0,0,0,43],[307,"Wyrm ring","crafting","Rings",95,8,1200,[[356,1],[180,2]],358,1,0,0,0,0,0,43],[234,"Silver amulet","crafting","Amulets",30,6,84,[[4,1],[180,1]],184,1,0,0,0,0,0,43],[235,"Gold amulet","crafting","Amulets",55,6,221,[[6,1],[180,1]],185,1,0,0,0,0,0,43],[236,"Meteoric amulet","crafting","Amulets",85,7,618,[[44,1],[180,2]],186,1,0,0,0,0,0,43],[306,"Leviathan amulet","crafting","Amulets",95,8,1400,[[355,1],[180,2]],357,1,0,0,0,0,0,43],[260,"Pelt coif","crafting","Leather",1,6,8,[[240,2]],260,1,0,0,0,0,0,43],[261,"Pelt chaps","crafting","Leather",1,6,12,[[240,3]],262,1,0,0,0,0,0,43],[262,"Pelt jerkin","crafting","Leather",1,6,20,[[240,5]],261,1,0,0,0,0,0,43],[263,"Bogskin coif","crafting","Leather",15,6,22,[[241,2]],263,1,0,0,0,0,0,43],[264,"Bogskin chaps","crafting","Leather",15,6,33,[[241,3]],265,1,0,0,0,0,0,43],[265,"Bogskin jerkin","crafting","Leather",15,6,55,[[241,5]],264,1,0,0,0,0,0,43],[266,"Chitin coif","crafting","Leather",30,6,60,[[242,2]],266,1,0,0,0,0,0,43],[267,"Chitin chaps","crafting","Leather",30,6,90,[[242,3]],268,1,0,0,0,0,0,43],[268,"Chitin jerkin","crafting","Leather",30,6,150,[[242,5]],267,1,0,0,0,0,0,43],[269,"Fur coif","crafting","Leather",60,7,180,[[245,2]],269,1,0,0,0,0,0,43],[270,"Fur chaps","crafting","Leather",60,7,270,[[245,3]],271,1,0,0,0,0,0,43],[271,"Fur jerkin","crafting","Leather",60,7,450,[[245,5]],270,1,0,0,0,0,0,43],[272,"Scale coif","crafting","Leather",85,7,460,[[247,2]],272,1,0,0,0,0,0,43],[273,"Scale chaps","crafting","Leather",85,7,690,[[247,3]],274,1,0,0,0,0,0,43],[274,"Scale jerkin","crafting","Leather",85,7,1150,[[247,5]],273,1,0,0,0,0,0,43],[289,"Troll coif","crafting","Leather",95,8,1250,[[248,2]],338,1,0,0,0,0,0,43],[290,"Troll chaps","crafting","Leather",95,8,1900,[[248,3]],340,1,0,0,0,0,0,43],[291,"Troll jerkin","crafting","Leather",95,8,3100,[[248,5]],339,1,0,0,0,0,0,43],[240,"Bread stall","thieving","Stalls",1,6,8,[],200,6,0,0,0,0,0,80],[241,"Silk stall","thieving","Stalls",25,7,30,[],200,28,191,0.03333333333333333,0,0,0,81],[242,"Gem stall","thieving","Stalls",50,8,80,[],200,90,100,0.04,0,0,0,82],[243,"Relic stall","thieving","Stalls",75,9,200,[],200,260,208,0.03,0,0,0,83],[244,"Linen line","thieving","Cloth",1,7,7,[],300,1,0,0,0,0,0,359],[245,"Silk cart","thieving","Cloth",25,8,26,[],301,1,0,0,0,0,0,360],[246,"Gilded loom","thieving","Cloth",50,9,70,[],302,1,0,0,0,0,0,361],[247,"Reliquary vestry","thieving","Cloth",75,10,175,[],303,1,0,0,0,0,0,362],[248,"Homespun hood","crafting","Cloth",1,6,9,[[300,2]],304,1,0,0,0,0,0,43],[249,"Homespun skirt","crafting","Cloth",1,6,14,[[300,3]],306,1,0,0,0,0,0,43],[250,"Homespun robe","crafting","Cloth",1,6,23,[[300,5]],305,1,0,0,0,0,0,43],[251,"Silk hood","crafting","Cloth",25,6,50,[[301,2]],307,1,0,0,0,0,0,43],[252,"Silk skirt","crafting","Cloth",25,6,75,[[301,3]],309,1,0,0,0,0,0,43],[253,"Silk robe","crafting","Cloth",25,6,125,[[301,5]],308,1,0,0,0,0,0,43],[254,"Gilded hood","crafting","Cloth",50,7,145,[[302,2]],310,1,0,0,0,0,0,43],[255,"Gilded skirt","crafting","Cloth",50,7,215,[[302,3]],312,1,0,0,0,0,0,43],[256,"Gilded robe","crafting","Cloth",50,7,360,[[302,5]],311,1,0,0,0,0,0,43],[257,"Voidweave hood","crafting","Cloth",75,7,380,[[303,2]],313,1,0,0,0,0,0,43],[258,"Voidweave skirt","crafting","Cloth",75,7,570,[[303,3]],315,1,0,0,0,0,0,43],[259,"Voidweave robe","crafting","Cloth",75,7,950,[[303,5]],314,1,0,0,0,0,0,43],[295,"Wightweave hood","crafting","Cloth",90,8,1000,[[303,2],[250,1]],344,1,0,0,0,0,0,43],[296,"Wightweave skirt","crafting","Cloth",90,8,1500,[[303,3],[250,2]],346,1,0,0,0,0,0,43],[297,"Wightweave robe","crafting","Cloth",90,8,2500,[[303,5],[250,3]],345,1,0,0,0,0,0,43],[275,"Pelt gloves","crafting","Gloves",5,6,10,[[240,4]],323,1,0,0,0,0,0,43],[276,"Bogskin gloves","crafting","Gloves",25,6,28,[[241,2],[202,1]],324,1,0,0,0,0,0,43],[277,"Chitin gloves","crafting","Gloves",45,6,75,[[242,2],[203,1]],325,1,0,0,0,0,0,43],[278,"Bone gloves","crafting","Gloves",65,7,225,[[243,2],[204,1]],326,1,0,0,0,0,0,43],[280,"Pelt quiver","fletching","Quivers",1,5,14,[[240,2],[10,1]],329,1,0,0,0,0,0,43],[281,"Bogskin quiver","fletching","Quivers",15,5,34,[[241,2],[11,1]],330,1,0,0,0,0,0,43],[282,"Chitin quiver","fletching","Quivers",30,5,70,[[242,2],[12,1]],331,1,0,0,0,0,0,43],[283,"Fur quiver","fletching","Quivers",60,5,150,[[245,2],[13,1]],332,1,0,0,0,0,0,43],[284,"Scale quiver","fletching","Quivers",85,5,320,[[247,2],[14,1]],333,1,0,0,0,0,0,43],[298,"Troll quiver","fletching","Quivers",95,6,700,[[248,2],[15,1]],347,1,0,0,0,0,0,43],[285,"Linen grimoire","crafting","Grimoires",1,6,16,[[300,3]],334,1,0,0,0,0,0,43],[286,"Silk grimoire","crafting","Grimoires",25,6,85,[[301,3],[241,1]],335,1,0,0,0,0,0,43],[287,"Gilded grimoire","crafting","Grimoires",50,7,230,[[302,3],[244,1]],336,1,0,0,0,0,0,43],[288,"Voidweave grimoire","crafting","Grimoires",75,7,560,[[303,3],[246,2]],337,1,0,0,0,0,0,43],[300,"Wightweave grimoire","crafting","Grimoires",90,8,1200,[[303,3],[250,2]],349,1,0,0,0,0,0,43],[279,"Scale gloves","crafting","Gloves",85,7,575,[[247,2],[206,1]],327,1,0,0,0,0,0,43]];
const ITEM_ROWS = [[1,"Copper",3,0],[2,"Tin",4,0],[3,"Iron",12,0],[4,"Silver",40,0],[5,"Coal",55,0],[6,"Gold",140,0],[7,"Cobalt",380,0],[8,"Meteoric",900,0],[10,"Logs",3,0],[11,"Oak logs",15,0],[12,"Willow logs",45,0],[13,"Maple logs",100,0],[14,"Yew logs",240,0],[15,"Magic logs",600,0],[20,"Shrimp",4,0],[21,"Sardine",9,0],[22,"Trout",26,0],[23,"Salmon",48,0],[24,"Tuna",92,0],[25,"Lobster",175,0],[26,"Swordfish",330,0],[27,"Shark",780,0],[40,"Bronze bar",12,0],[41,"Iron bar",22,0],[42,"Steel bar",156,0],[43,"Cobalt bar",660,0],[44,"Meteoric bar",1527,0],[45,"Salted shrimp",9,0],[46,"Salted sardine",15,0],[47,"Salted trout",44,0],[48,"Salted salmon",82,0],[49,"Salted tuna",150,0],[50,"Salted lobster",290,0],[51,"Salted swordfish",550,0],[52,"Salted shark",1280,0],[78,"Spice",0,1],[54,"Packed lunch",1100,0],[55,"Hearty lunch",2560,0],[60,"Cooked shrimp",9,0],[61,"Cooked sardine",15,0],[62,"Cooked trout",44,0],[63,"Cooked salmon",82,0],[64,"Cooked tuna",150,0],[65,"Cooked lobster",290,0],[66,"Cooked swordfish",550,0],[67,"Cooked shark",1280,0],[70,"Burnt food",0,1],[71,"Potato stew",122,0],[72,"Glowcap stew",166,0],[73,"Turnip stew",237,0],[74,"Bitterroot stew",370,0],[75,"Voidmelon stew",650,0],[76,"Ember stew",1170,0],[77,"Fire stew",1900,0],[53,"Salt",0,1],[80,"Bronze pickaxe",29,0],[81,"Iron pickaxe",54,0],[82,"Steel pickaxe",346,0],[83,"Cobalt pickaxe",1435,0],[84,"Meteoric pickaxe",3461,0],[85,"Bronze rod",20,0],[86,"Iron rod",47,0],[87,"Steel rod",235,0],[88,"Cobalt rod",1015,0],[89,"Meteoric rod",2534,0],[90,"Bronze axe",29,0],[91,"Iron axe",54,0],[92,"Steel axe",346,0],[93,"Cobalt axe",1435,0],[94,"Meteoric axe",3461,0],[110,"Bronze blade",17,0],[111,"Iron blade",32,0],[112,"Steel blade",190,0],[113,"Cobalt blade",775,0],[114,"Meteoric blade",1934,0],[115,"Bronze shield",41,0],[116,"Iron shield",76,0],[117,"Steel shield",502,0],[118,"Cobalt shield",2095,0],[119,"Meteoric shield",4988,0],[120,"Bronze helm",29,0],[121,"Iron helm",54,0],[122,"Steel helm",346,0],[123,"Cobalt helm",1435,0],[124,"Meteoric helm",3461,0],[125,"Bronze plate",65,0],[126,"Iron plate",120,0],[127,"Steel plate",814,0],[128,"Cobalt plate",3415,0],[129,"Meteoric plate",8042,0],[130,"Bronze greaves",53,0],[131,"Iron greaves",98,0],[132,"Steel greaves",658,0],[133,"Cobalt greaves",2755,0],[134,"Meteoric greaves",6515,0],[140,"Shortbow",8,0],[141,"Oak shortbow",25,0],[142,"Willow shortbow",79,0],[143,"Maple shortbow",158,0],[144,"Yew shortbow",355,0],[145,"Magic shortbow",820,0],[146,"Longbow",11,0],[147,"Oak longbow",40,0],[148,"Willow longbow",124,0],[149,"Maple longbow",258,0],[150,"Yew longbow",595,0],[151,"Magic longbow",1420,0],[152,"Staff",11,0],[153,"Oak staff",40,0],[154,"Willow staff",124,0],[155,"Maple staff",258,0],[156,"Yew staff",595,0],[157,"Magic staff",1420,0],[100,"Rough gem",2500,1],[200,"Coins",1,1],[201,"Gnawed charm",1500,1],[202,"Bog pearl",4000,1],[203,"Dry sigil",12000,1],[204,"Cairn token",40000,1],[205,"Rime fang",120000,1],[206,"Ember heart",350000,1],[207,"Abyssal eye",900000,1],[208,"Voidshard",1500,1],[160,"Potato seed",2,1],[161,"Glowcap spore",6,1],[162,"Turnip seed",14,1],[163,"Bitterroot seed",30,1],[164,"Voidmelon seed",60,1],[165,"Pepper seed",110,1],[170,"Potato",7,0],[171,"Glowcap",22,0],[172,"Cave turnip",55,0],[173,"Bitterroot",120,0],[174,"Voidmelon",260,0],[175,"Ember pepper",520,0],[180,"Cut gem",2505,1],[181,"Silver ring",2563,0],[182,"Gold ring",2703,0],[183,"Meteoric ring",6757,0],[184,"Silver amulet",2579,0],[185,"Gold amulet",2741,0],[186,"Meteoric amulet",6944,0],[190,"Sage seed",6,1],[191,"Nightshade seed",40,1],[192,"Dragonleaf seed",220,1],[193,"Sage",18,1],[194,"Nightshade",110,1],[195,"Dragonleaf",520,1],[209,"Gravemaw skull",250000,0],[210,"Hollow crown",1000000,0],[211,"Riftborne heart",4000000,0],[212,"Colossus core",15000000,0],[213,"Wraith ash",15000,1],[214,"Stalker fang",30000,1],[215,"Troll tusk",50000,1],[216,"Wight crown",120000,1],[217,"Drake scale",250000,1],[218,"Colossus ember",500000,1],[220,"Gatherer's draught",28,1],[221,"Hunter's brew",272,1],[222,"Warrior's tonic",835,1],[223,"Elixir of the vein",1643,1],[224,"Abyssal tonic",2103,1],[225,"Swift draught",96,1],[226,"Nourishing draught",387,1],[227,"Haste draught",1205,1],[240,"Gnawer pelt",5,1],[241,"Bogling skin",12,1],[242,"Husk chitin",60,1],[243,"Cairn bone",120,1],[244,"Wraith dust",200,1],[245,"Rimewolf fur",500,1],[246,"Stalker claw",700,1],[247,"Ember scale",1200,1],[248,"Troll hide",800,1],[249,"Horror ichor",1000,1],[250,"Ice wight shard",1500,1],[251,"Drake hide",2000,1],[252,"Colossus chip",3000,1],[260,"Pelt coif",15,0],[261,"Pelt jerkin",30,0],[262,"Pelt chaps",20,0],[263,"Bogskin coif",34,0],[264,"Bogskin jerkin",70,0],[265,"Bogskin chaps",46,0],[266,"Chitin coif",154,0],[267,"Chitin jerkin",334,0],[268,"Chitin chaps",214,0],[269,"Fur coif",1115,0],[270,"Fur jerkin",2615,0],[271,"Fur chaps",1615,0],[272,"Scale coif",2807,0],[273,"Scale jerkin",6407,0],[274,"Scale chaps",4007,0],[300,"Homespun bolt",12,1],[301,"Silk bolt",70,1],[302,"Gilded bolt",260,1],[303,"Voidweave bolt",900,1],[304,"Homespun hood",29,0],[305,"Homespun robe",65,0],[306,"Homespun skirt",41,0],[307,"Silk hood",166,0],[308,"Silk robe",376,0],[309,"Silk skirt",236,0],[310,"Gilded hood",597,0],[311,"Gilded robe",1377,0],[312,"Gilded skirt",857,0],[313,"Voidweave hood",2020,0],[314,"Voidweave robe",4720,0],[315,"Voidweave skirt",2920,0],[316,"Rock mite nymph",0,0],[317,"Fen lurker spawn",0,0],[318,"Grave beetle grub",0,0],[319,"Sump crawler hatchling",0,0],[320,"Stone eater pebble",0,0],[321,"Barrow pup",0,0],[322,"Chalk wightling",0,0],[323,"Pelt gloves",75,0],[324,"Bogskin gloves",4000,0],[325,"Chitin gloves",12000,0],[326,"Bone gloves",40000,0],[327,"Scale gloves",350000,0],[328,"Horse",10000,0],[329,"Pelt quiver",18,0],[330,"Bogskin quiver",49,0],[331,"Chitin quiver",199,0],[332,"Fur quiver",1215,0],[333,"Scale quiver",3047,0],[334,"Linen grimoire",41,0],[335,"Silk grimoire",248,0],[336,"Gilded grimoire",1057,0],[337,"Voidweave grimoire",4320,0],[338,"Troll coif",2183,0],[339,"Troll jerkin",4583,0],[340,"Troll chaps",2983,0],[341,"Drake coif",4650,0],[342,"Drake jerkin",10650,0],[343,"Drake chaps",6650,0],[344,"Wightweave hood",3800,0],[345,"Wightweave robe",9500,0],[346,"Wightweave skirt",6200,0],[347,"Troll quiver",2783,0],[348,"Drake quiver",5850,0],[349,"Wightweave grimoire",6200,0],[350,"Colossus blade",11231,0],[351,"Colossus shield",11231,0],[352,"Colossus helm",6704,0],[353,"Colossus plate",17285,0],[354,"Colossus greaves",12758,0],[355,"Leviathan scale",20000,1],[356,"Wyrm ember",20000,1],[357,"Leviathan amulet",25593,0],[358,"Wyrm ring",25593,0],[359,"Protection scroll",10,1],[360,"Bronze pan",17,0],[361,"Iron pan",32,0],[362,"Steel pan",190,0],[363,"Cobalt pan",775,0],[364,"Meteoric pan",1934,0],[365,"Bronze hammer",29,0],[366,"Iron hammer",54,0],[367,"Steel hammer",346,0],[368,"Cobalt hammer",1435,0],[369,"Meteoric hammer",3461,0],[370,"Bronze knife",17,0],[371,"Iron knife",32,0],[372,"Steel knife",190,0],[373,"Cobalt knife",775,0],[374,"Meteoric knife",1934,0],[375,"Bronze needle",17,0],[376,"Iron needle",32,0],[377,"Steel needle",190,0],[378,"Cobalt needle",775,0],[379,"Meteoric needle",1934,0],[380,"Bronze mortar",29,0],[381,"Iron mortar",54,0],[382,"Steel mortar",346,0],[383,"Cobalt mortar",1435,0],[384,"Meteoric mortar",3461,0],[385,"Bronze hoe",23,0],[386,"Iron hoe",62,0],[387,"Steel hoe",280,0],[388,"Cobalt hoe",1255,0],[389,"Meteoric hoe",3134,0],[390,"Bronze greatsword",29,0],[391,"Iron greatsword",54,0],[392,"Steel greatsword",346,0],[393,"Cobalt greatsword",1435,0],[394,"Meteoric greatsword",3461,0],[395,"Colossus greatsword",12704,0],[396,"Golden Week gift box",25,1],[397,"Moon box",25,1],[398,"Cinder Imp",0,0],[399,"Moon Jelly",0,0],[574,"Puffcap",0,0],[400,"Pebble golem",0,0],[401,"Baby kraken",0,0],[402,"Acorn squirrel",0,0],[403,"Queen bee",0,0],[404,"Raccoon",0,0],[405,"Chef rat",0,0],[406,"Ember salamander",0,0],[407,"Fletch falcon",0,0],[408,"Toadstool",0,0],[409,"Yarn kitten",0,0],[410,"Star fairy",0,0],[684,"Embers",0,1],[687,"Cooling draught",0,1],[690,"Forge coke",0,1],[693,"Forge bread",0,1],[664,"Heartforger gloves",0,0],[696,"Heart in Glass",0,0],[572,"Tideforged rod",3294,0],[573,"Tideforged pan",2514,0],[575,"Sporeforged axe",4499,0],[576,"Sporeforged knife",2514,0],[698,"Heartforged pickaxe",4499,0],[699,"Heartforged hammer",4499,0],[706,"Blooms",0,1],[708,"Blight in a Pot",0,0],[709,"Smudge herbs",0,1],[710,"Sproutling",0,0],[711,"Bloomforged hoe",4074,0],[712,"Bloomforged mortar",4499,0],[713,"Honours",0,1],[715,"Model Keep",0,0],[716,"Beacon pitch",0,1],[717,"Little Ram",0,0],[718,"Wardenforged gloves",455000,0],[719,"Wardenforged needle",2514,0],[730,"Raidstone Whetstone",0,0],[685,"Wreck coins",0,1],[688,"Abyssal Pearl",2000,1],[691,"Kraken's Arm",0,0],[694,"Chum",0,1],[686,"Spores",0,1],[689,"Living Heartwood",2000,1],[692,"Colony in a Jar",0,0],[695,"Lampwood",0,1],[697,"Heart Core",2000,1],[707,"Living Seed",2000,1],[714,"Keystone",2000,1],[731,"Heart Core shard",20,1],[732,"Pearl fragment",20,1],[733,"Heartwood splinter",20,1],[734,"Seed husk",20,1],[735,"Keystone chip",20,1],[280,"Gnawer pup",0,0],[281,"Bogling tadpole",0,0],[282,"Husk grub",0,0],[283,"Cairn wisp",0,0],[284,"Rimewolf cub",0,0],[285,"Emberkin spark",0,0],[286,"Horror spawn",0,0],[287,"Wraith mote",0,0],[288,"Stalker kit",0,0],[289,"Frost troll whelp",0,0],[290,"Ice wight shard-child",0,0],[291,"Ash drake hatchling",0,0],[292,"Cinder ember",0,0],[293,"Gem pack",10,1],[294,"Pouch of gems",1200,1],[295,"Chest of gems",2600,1],[296,"Vein of gems",7000,1],[297,"Hoard of gems",15000,1],[700,"Firework powder",0,1],[760,"Singles' Day box",25,1],[761,"Jade Pixiu",0,0],[762,"Community gift box",25,1],[763,"Mystery box",0,0],[764,"Enhance essence",1,1],[770,"Bronze flask",2534,0],[771,"Iron flask",2559,0],[772,"Steel flask",2851,0],[773,"Cobalt flask",3940,0],[774,"Meteoric flask",5966,0],[775,"Clean essence",1,1],[776,"Philosopher's piece",50,1],[777,"Philosopher's Stone",0,0],[778,"Boss essence",1,1],[779,"House essence",1,1]];
const ZH_NAMES = {"Copper":"铜矿","Tin":"锡矿","Iron":"铁矿","Silver":"银矿","Coal":"煤炭","Gold":"金矿","Cobalt":"钴矿","Meteoric":"陨铁矿","Bronze bar":"青铜锭","Iron bar":"铁锭","Steel bar":"钢锭","Cobalt bar":"钴锭","Meteoric bar":"陨铁锭","Logs":"原木","Oak logs":"橡木","Willow logs":"柳木","Maple logs":"枫木","Yew logs":"紫杉木","Magic logs":"魔法原木","Shrimp":"虾","Sardine":"沙丁鱼","Trout":"鳟鱼","Salmon":"三文鱼","Tuna":"金枪鱼","Lobster":"龙虾","Swordfish":"剑鱼","Shark":"鲨鱼","Cooked shrimp":"熟虾","Cooked sardine":"熟沙丁鱼","Cooked trout":"熟鳟鱼","Cooked salmon":"熟三文鱼","Cooked tuna":"熟金枪鱼","Cooked lobster":"熟龙虾","Cooked swordfish":"熟剑鱼","Cooked shark":"熟鲨鱼","Burnt food":"烧焦的食物","Salt":"盐","Potato stew":"土豆炖鱼","Glowcap stew":"荧光菇炖鱼","Turnip stew":"芜菁炖鱼","Bitterroot stew":"苦根炖鱼","Voidmelon stew":"虚空瓜炖鱼","Ember stew":"余烬炖鱼","Fire stew":"烈焰炖鱼","Salted shrimp":"腌虾","Salted sardine":"腌沙丁鱼","Salted trout":"腌鳟鱼","Salted salmon":"腌三文鱼","Salted tuna":"腌金枪鱼","Salted lobster":"腌龙虾","Salted swordfish":"腌剑鱼","Salted shark":"腌鲨鱼","Spice":"香料","Packed lunch":"便当","Hearty lunch":"丰盛便当","Bronze pickaxe":"青铜镐","Bronze axe":"青铜斧","Bronze rod":"青铜钓竿","Bronze hammer":"青铜锤","Bronze knife":"青铜刀","Bronze needle":"青铜针","Bronze pan":"青铜平底锅","Bronze mortar":"青铜研钵","Bronze hoe":"青铜锄","Bronze blade":"青铜剑","Bronze greatsword":"青铜大剑","Bronze shield":"青铜盾","Bronze helm":"青铜头盔","Bronze plate":"青铜铠甲","Bronze greaves":"青铜护腿","Iron pickaxe":"铁镐","Iron axe":"铁斧","Iron rod":"铁钓竿","Iron hammer":"铁锤","Iron knife":"铁刀","Iron needle":"铁针","Iron pan":"铁平底锅","Iron mortar":"铁研钵","Iron hoe":"铁锄","Iron blade":"铁剑","Iron greatsword":"铁大剑","Iron shield":"铁盾","Iron helm":"铁头盔","Iron plate":"铁铠甲","Iron greaves":"铁护腿","Steel pickaxe":"钢镐","Steel axe":"钢斧","Steel rod":"钢钓竿","Steel hammer":"钢锤","Steel knife":"钢刀","Steel needle":"钢针","Steel pan":"钢平底锅","Steel mortar":"钢研钵","Steel hoe":"钢锄","Steel blade":"钢剑","Steel greatsword":"钢大剑","Steel shield":"钢盾","Steel helm":"钢头盔","Steel plate":"钢铠甲","Steel greaves":"钢护腿","Cobalt pickaxe":"钴镐","Cobalt axe":"钴斧","Cobalt rod":"钴钓竿","Cobalt hammer":"钴锤","Cobalt knife":"钴刀","Cobalt needle":"钴针","Cobalt pan":"钴平底锅","Cobalt mortar":"钴研钵","Cobalt hoe":"钴锄","Cobalt blade":"钴剑","Cobalt greatsword":"钴大剑","Cobalt shield":"钴盾","Cobalt helm":"钴头盔","Cobalt plate":"钴铠甲","Cobalt greaves":"钴护腿","Meteoric pickaxe":"陨铁镐","Meteoric axe":"陨铁斧","Meteoric rod":"陨铁钓竿","Meteoric hammer":"陨铁锤","Meteoric knife":"陨铁刀","Meteoric needle":"陨铁针","Meteoric pan":"陨铁平底锅","Meteoric mortar":"陨铁研钵","Meteoric hoe":"陨铁锄","Meteoric blade":"陨铁剑","Meteoric greatsword":"陨铁大剑","Meteoric shield":"陨铁盾","Meteoric helm":"陨铁头盔","Meteoric plate":"陨铁铠甲","Meteoric greaves":"陨铁护腿","Colossus blade":"巨像之剑","Colossus greatsword":"巨像大剑","Colossus shield":"巨像之盾","Colossus helm":"巨像头盔","Colossus plate":"巨像铠甲","Colossus greaves":"巨像护腿","Colossus chip":"巨像碎片","Colossus core":"巨像核心","Protection scroll":"保护卷轴","Enhance essence":"强化精华","Colossus ember":"巨像余烬","Shortbow":"短弓","Longbow":"长弓","Staff":"法杖","Oak shortbow":"橡木短弓","Oak longbow":"橡木长弓","Oak staff":"橡木法杖","Willow shortbow":"柳木短弓","Willow longbow":"柳木长弓","Willow staff":"柳木法杖","Maple shortbow":"枫木短弓","Maple longbow":"枫木长弓","Maple staff":"枫木法杖","Yew shortbow":"紫杉短弓","Yew longbow":"紫杉长弓","Yew staff":"紫杉法杖","Magic shortbow":"魔法短弓","Magic longbow":"魔法长弓","Magic staff":"魔法法杖","Gold amulet":"黄金护符","Silver amulet":"白银护符","Meteoric amulet":"陨铁护符","Leviathan amulet":"利维坦护符","Gold ring":"黄金戒指","Silver ring":"白银戒指","Meteoric ring":"陨铁戒指","Wyrm ring":"巨龙戒指","Fur coif":"毛皮头巾","Fur jerkin":"毛皮上衣","Fur chaps":"毛皮护腿","Fur quiver":"毛皮箭袋","Pelt coif":"兽皮头巾","Pelt jerkin":"兽皮上衣","Pelt chaps":"兽皮护腿","Pelt gloves":"兽皮手套","Pelt quiver":"兽皮箭袋","Bogskin coif":"沼皮头巾","Bogskin jerkin":"沼皮上衣","Bogskin chaps":"沼皮护腿","Bogskin gloves":"沼皮手套","Bogskin quiver":"沼皮箭袋","Scale coif":"鳞片头巾","Scale jerkin":"鳞片上衣","Scale chaps":"鳞片护腿","Scale gloves":"鳞片手套","Scale quiver":"鳞片箭袋","Chitin coif":"甲壳头巾","Chitin jerkin":"甲壳上衣","Chitin chaps":"甲壳护腿","Chitin gloves":"甲壳手套","Chitin quiver":"甲壳箭袋","Drake coif":"幼龙头巾","Drake jerkin":"幼龙上衣","Drake chaps":"幼龙护腿","Drake quiver":"幼龙箭袋","Bone gloves":"骨手套","Homespun robe":"粗布长袍","Homespun hood":"粗布兜帽","Homespun skirt":"粗布裙","Homespun bolt":"粗布匹","Linen grimoire":"亚麻魔典","Silk grimoire":"丝绸魔典","Gilded grimoire":"镀金魔典","Voidweave grimoire":"虚织魔典","Wightweave grimoire":"尸织魔典","Wightweave hood":"尸织兜帽","Wightweave robe":"尸织长袍","Wightweave skirt":"尸织裙","Silk robe":"丝绸长袍","Silk hood":"丝绸兜帽","Silk skirt":"丝绸裙","Silk bolt":"丝绸布匹","Gilded robe":"镀金长袍","Gilded hood":"镀金兜帽","Gilded skirt":"镀金裙","Gilded bolt":"镀金布匹","Voidweave robe":"虚织长袍","Voidweave hood":"虚织兜帽","Voidweave skirt":"虚织裙","Voidweave bolt":"虚织布匹","Coins":"金币","Rough gem":"粗糙宝石","Cut gem":"切割宝石","Gem pack":"宝石包","Golden Week gift box":"金秋礼盒","Moon box":"满月礼盒","Pouch of gems":"宝石袋","Chest of gems":"宝石箱","Hoard of gems":"宝石堆","Vein of gems":"宝石矿脉","Haste draught":"急速药剂","Swift draught":"疾行药剂","Nourishing draught":"滋养药剂","Abyssal tonic":"深渊补剂","Elixir of the vein":"矿脉灵药","Potato":"土豆","Potato seed":"土豆种子","Turnip seed":"芜菁种子","Cave turnip":"洞穴芜菁","Sage":"鼠尾草","Sage seed":"鼠尾草种子","Nightshade":"颠茄","Nightshade seed":"颠茄种子","Bitterroot":"苦根","Bitterroot seed":"苦根种子","Dragonleaf":"龙叶","Dragonleaf seed":"龙叶种子","Ember pepper":"余烬辣椒","Pepper seed":"辣椒种子","Voidmelon":"虚空瓜","Voidmelon seed":"虚空瓜种子","Glowcap":"荧光菇","Glowcap spore":"荧光菇孢子","Pebble golem":"小石魔像","Baby kraken":"小海妖","Acorn squirrel":"橡果松鼠","Queen bee":"蜂后","Raccoon":"浣熊","Chef rat":"厨师鼠","Ember salamander":"余烬蝾螈","Fletch falcon":"箭羽隼","Toadstool":"毒蘑菇人","Yarn kitten":"毛线小猫","Star fairy":"星辰小仙","Horse":"马","Ash drake hatchling":"灰龙幼崽","Barrow pup":"冢穴幼兽","Rimewolf cub":"霜狼幼崽","Frost troll whelp":"霜巨魔幼崽","Gnawer pup":"啃噬者幼崽","Abyssal eye":"深渊之眼","Bog pearl":"沼泽珍珠","Bogling skin":"沼灵皮","Bogling tadpole":"沼灵蝌蚪","Cairn bone":"石冢骨","Cairn token":"石冢徽记","Cairn wisp":"石冢幽光","Chalk wightling":"白垩尸灵","Cinder ember":"灰烬余火","Drake hide":"幼龙皮","Drake scale":"幼龙鳞","Dry sigil":"干枯符印","Ember heart":"余烬之心","Ember scale":"余烬之鳞","Emberkin spark":"余烬灵火花","Fen lurker spawn":"沼潜者幼体","Gnawed charm":"啃噬护符","Gnawer pelt":"啃噬者毛皮","Grave beetle grub":"墓甲虫幼虫","Gravemaw skull":"墓噬者头骨","Hollow crown":"空心王冠","Horror ichor":"恐魔脓液","Horror spawn":"恐魔幼体","Husk chitin":"空壳甲壳","Husk grub":"空壳幼虫","Ice wight shard":"冰尸碎片","Ice wight shard-child":"冰尸幼体","Leviathan scale":"利维坦之鳞","Riftborne heart":"裂生之心","Rime fang":"寒霜之牙","Rimewolf fur":"霜狼毛皮","Rock mite nymph":"岩螨若虫","Stalker claw":"潜袭者之爪","Stalker fang":"潜袭者之牙","Stalker kit":"潜袭者幼崽","Stone eater pebble":"食石者卵石","Sump crawler hatchling":"污水爬行者幼体","Troll hide":"巨魔皮","Troll tusk":"巨魔獠牙","Troll coif":"巨魔头巾","Troll jerkin":"巨魔上衣","Troll chaps":"巨魔护腿","Troll quiver":"巨魔箭袋","Wight crown":"尸灵王冠","Wraith ash":"怨灵之烬","Wraith dust":"怨灵之尘","Wraith mote":"怨灵微粒","Wyrm ember":"巨龙余烬","Voidshard":"虚空碎片","Firework powder":"烟花火药","Embers":"心火余烬","Cooling draught":"冷却药剂","Forge coke":"锻炉焦炭","Forge bread":"锻炉面包","Heartforger gloves":"心火锻师手套","Heart in Glass":"玻璃之心","Heartforged pickaxe":"心火锻造镐","Heart Core":"心火之核","Heart Core shard":"心火之核碎片","Pearl fragment":"珍珠碎片","Heartwood splinter":"活心木碎片","Seed husk":"活种碎壳","Keystone chip":"拱心石碎块","Cinder Imp":"烬火小魔","Heartforged hammer":"心火锻造锤","Wreck coins":"沉船金币","Abyssal Pearl":"深渊珍珠","Kraken's Arm":"海妖之臂","Chum":"鱼饵碎","Moon Jelly":"月水母","Tideforged rod":"潮锻鱼竿","Tideforged pan":"潮锻煎锅","Spores":"孢子","Living Heartwood":"活心木","Colony in a Jar":"瓶中菌群","Lampwood":"灯木","Puffcap":"蓬帽菇","Sporeforged axe":"孢锻斧","Sporeforged knife":"孢锻刀","Blooms":"花瓣币","Living Seed":"活种","Blight in a Pot":"盆中枯萎之花","Smudge herbs":"熏药草","Sproutling":"小芽苗","Bloomforged hoe":"花锻锄头","Bloomforged mortar":"花锻研钵","Honours":"荣誉","Keystone":"拱心石","Model Keep":"要塞模型","Beacon pitch":"烽火沥青","Little Ram":"小撞羊","Singles' Day box":"双十一礼盒","Jade Pixiu":"玉貅","Community gift box":"社区礼盒","Wardenforged gloves":"守望锻手套","Raidstone Whetstone":"突袭石磨刀石","Wardenforged needle":"守望锻针","Bronze flask":"青铜烧瓶","Iron flask":"铁烧瓶","Steel flask":"钢烧瓶","Cobalt flask":"钴烧瓶","Meteoric flask":"陨铁烧瓶","Clean essence":"纯净精华","Philosopher's piece":"贤者之石碎片","Philosopher's Stone":"贤者之石","Boss essence":"首领精华","House essence":"家园精华"};
/* ===== core.js ===== */
/* =========================================================================
 * dvi-profit · core：常量、工具、经验表、静态数据、市场价、游戏状态读取
 * ========================================================================= */

const TICK_MS = 600;                 // 一个 tick = 600ms（游戏常量 ue）
const TICKS_PER_HOUR = 3600 * 1000 / TICK_MS;  // 6000
const TAX_BP_DEFAULT = 200;          // 市场税 2%
const COIN_ITEM = 200;               // “金币”这个物品 id
const STRIDE_RARITY = 1000;          // 编码：品质步长
const STRIDE_PLUS = 10000;           // 编码：强化步长

const PREF_KEY = 'dvi.profit.settings.v1';
const PRICE_KEY = 'dvi.profit.prices.v1';
const CALIB_KEY = 'dvi.profit.calib.v1';
const PRICE_URL = 'https://deepveinidle.com/api/market/prices.json';
const PRICE_TTL = 5 * 60 * 1000;     // 官方 5 分钟重建一次

// 自动更新：油猴按头部的 @updateURL 自行比对；这里再做一层自检，方便看见/手动升级
const UPDATE_META = 'https://raw.githubusercontent.com/clmodos/git-learn-yjl/master/dvi-userscripts/dvi-profit.meta.js';
const UPDATE_PAGE = 'https://raw.githubusercontent.com/clmodos/git-learn-yjl/master/dvi-userscripts/dvi-profit.user.js';
const UPDATE_KEY = 'dvi.profit.update.v1';
const UPDATE_TTL = 6 * 60 * 60 * 1000;

/* ------------------------------ 小工具 ------------------------------ */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const sleep = ms => new Promise(done => setTimeout(done, ms));
const now = () => Date.now();

function fmtInt(value) {
  const v = Math.round(num(value));
  return v.toLocaleString('zh-CN');
}

// 1.2k / 34.5m / 1.02b：金币量级缩写
function fmtGold(value) {
  const v = num(value);
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs < 1000) return sign + Math.round(abs);
  if (abs < 1e6) return sign + (abs / 1e3).toFixed(abs < 1e4 ? 2 : 1).replace(/\.0+$/, '') + 'k';
  if (abs < 1e9) return sign + (abs / 1e6).toFixed(abs < 1e7 ? 2 : 1).replace(/\.0+$/, '') + 'm';
  if (abs < 1e12) return sign + (abs / 1e9).toFixed(2).replace(/\.0+$/, '') + 'b';
  return sign + (abs / 1e12).toFixed(2) + 't';
}

function fmtDuration(hours) {
  const h = num(hours);
  if (!(h > 0)) return '—';
  if (h < 1 / 60) return '<1分';
  if (h < 1) return Math.round(h * 60) + '分';
  if (h < 48) return (h < 10 ? h.toFixed(1) : Math.round(h)) + '小时';
  const days = h / 24;
  return (days < 10 ? days.toFixed(1) : Math.round(days)) + '天';
}

// 把用户输入的 “50m / 2.5b / 300k / 1234” 解析成金币数
function parseGold(text, fallback = 0) {
  const raw = String(text ?? '').trim().toLowerCase().replace(/[,\s金币]/g, '');
  if (!raw) return fallback;
  const m = /^(-?\d+(?:\.\d+)?)([kmbt])?$/.exec(raw);
  if (!m) return fallback;
  const scale = { '': 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[m[2] || ''];
  const value = Number(m[1]) * scale;
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const store = {
  read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch { return fallback; }
  },
  write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  }
};

/* ------------------------------ 经验表 ------------------------------
 * 与游戏一致：1→99 级用 baseXp 100、成长 1.12 的等比累加；
 * 99 级之后每级 +10% 基数的线性台阶，再逐级 ×1.145 放大。
 */
const LEVEL_XP = (() => {
  const table = [0, 0];
  for (let level = 2; level <= 99; level++) {
    table[level] = Math.round(100 * (Math.pow(1.12, level - 1) - 1) / 0.12);
  }
  let step = table[99] * 0.1;
  let total = table[99];
  for (let level = 100; level <= 200 && total < Number.MAX_SAFE_INTEGER; level++) {
    total += step;
    table[level] = Math.round(total);
    step *= 1.145;
  }
  return table;
})();
const MAX_LEVEL = LEVEL_XP.length - 1;

function levelAtXp(xp) {
  const value = Math.max(0, num(xp));
  if (value <= 0) return 1;
  let lo = 1, hi = MAX_LEVEL;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (LEVEL_XP[mid] <= value) lo = mid; else hi = mid - 1;
  }
  return lo;
}
const xpAtLevel = level => LEVEL_XP[clamp(Math.round(level), 1, MAX_LEVEL)] || 0;

/* --------------------------- 静态数据解码 --------------------------- */
const JOBS = [];
const JOB_BY_ID = new Map();
const ITEMS = new Map();
const ZH = ZH_NAMES;
const zhName = name => ZH[name] || name;

for (const row of JOB_ROWS) {
  const job = {
    id: row[0], name: row[1], zh: zhName(row[1]), skill: row[2], group: row[3],
    levelReq: row[4], baseTicks: row[5], xp: row[6],
    inputs: row[7].map(pair => ({ itemId: pair[0], qty: pair[1] })),
    outItem: row[8], outQty: row[9],
    bonusItem: row[10], bonusChance: row[11],
    grow: row[12] === 1, retired: row[13] === 1, plain: row[14] === 1,
    siteId: row[15],
    gather: row[7].length === 0
  };
  JOBS.push(job);
  JOB_BY_ID.set(job.id, job);
}
for (const row of ITEM_ROWS) ITEMS.set(row[0], { id: row[0], name: row[1], zh: zhName(row[1]), value: row[2], stackable: row[3] === 1 });

const WORK_SKILLS = ['mining', 'fishing', 'woodcutting', 'farming', 'thieving', 'cooking', 'smithing', 'fletching', 'herblore', 'crafting'];
const SKILL_ZH = {
  mining: '采矿', fishing: '钓鱼', woodcutting: '伐木', farming: '农业', thieving: '偷窃',
  cooking: '烹饪', smithing: '锻造', fletching: '制箭', herblore: '草药学', crafting: '加工',
  enhancing: '强化', alchemy: '炼金'
};
const skillZh = skill => SKILL_ZH[skill] || ZH[skill] || skill;
const itemName = itemId => {
  const item = ITEMS.get(itemId % STRIDE_PLUS);
  return item ? item.zh : '#' + itemId;
};

/* ------------------------------ 市场价 ------------------------------ */
let priceData = { at: 0, items: {}, loading: false, error: null };
const priceOf = itemId => priceData.items[itemId % STRIDE_PLUS] || null;

async function loadPrices(force = false) {
  if (priceData.loading) return priceData;
  if (!force) {
    const cached = store.read(PRICE_KEY, null);
    if (cached && cached.items && now() - cached.at < PRICE_TTL) {
      priceData = { at: cached.at, items: cached.items, loading: false, error: null };
      return priceData;
    }
    if (priceData.at && now() - priceData.at < PRICE_TTL) return priceData;
  }
  priceData = { ...priceData, loading: true };
  try {
    const response = await fetch(PRICE_URL + '?t=' + now(), { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const payload = await response.json();
    const items = {};
    for (const [key, row] of Object.entries(payload.items || {})) {
      if (!row || typeof row !== 'object') continue;
      items[Number(key)] = {
        lowestSell: num(row.lowestSell, 0),
        sellQty: num(row.sellQty, 0),
        highestBuy: num(row.highestBuy, 0),
        buyQty: num(row.buyQty, 0),
        avg7d: num(row.avg7d, 0),
        vol7d: num(row.vol7d, 0),
        avg30d: num(row.avg30d, 0)
      };
    }
    priceData = { at: now(), items, loading: false, error: null };
    store.write(PRICE_KEY, { at: priceData.at, items });
  } catch (error) {
    priceData = { ...priceData, loading: false, error: error.message || String(error) };
  }
  return priceData;
}

// 卖出参考价：instant=立刻成交到买一，ask=挂卖单（压卖一 1 金币）
function sellPriceOf(itemId, mode = 'instant') {
  if (itemId === COIN_ITEM) return 1;
  const row = priceOf(itemId);
  const item = ITEMS.get(itemId % STRIDE_PLUS);
  const fallback = item ? Math.max(1, Math.round(item.value * 0.8)) : 1;
  if (!row) return fallback;
  if (mode === 'instant') {
    if (row.highestBuy > 0) return row.highestBuy;
    return Math.round(row.avg7d * 0.85) || fallback;
  }
  if (row.lowestSell > 1) return row.lowestSell - 1;
  return Math.round(row.avg7d || row.lowestSell) || fallback;
}

// 买入参考价：吃卖一
function buyPriceOf(itemId) {
  const row = priceOf(itemId);
  const item = ITEMS.get(itemId % STRIDE_PLUS);
  const fallback = item ? Math.max(1, Math.round(item.value * 1.2)) : 1;
  if (!row) return fallback;
  return row.lowestSell || Math.round(row.avg7d * 1.15) || fallback;
}

/* ---------------------------- 游戏状态 ---------------------------- */
const gameSession = () => window.deepvein?.session || null;
function gameState() {
  const session = gameSession();
  if (!session) return null;
  if (session.connection && session.connection.live === false) return null;
  return session.state || null;
}
const isLive = () => {
  const session = gameSession();
  return !!session && session.connection?.live !== false && !!session.state;
};
const coinsOf = state => num(state?.coins, 0);
const xpOf = (state, skill) => num(state?.skills?.[skill], 0);
const levelOf = (state, skill) => levelAtXp(xpOf(state, skill));

// 背包（pack 是 [{itemId, qty}]），仓库（bank 是 {itemId: qty}），溢出栏
function stockOf(state, itemId, includeOverflow = false) {
  if (!state) return 0;
  let total = 0;
  for (const slot of state.pack || []) if (slot && slot.itemId === itemId) total += num(slot.qty, 0);
  total += num(state.bank?.[itemId], 0);
  if (includeOverflow) total += num(state.overflow?.[itemId], 0);
  return total;
}
const bankOf = (state, itemId) => num(state?.bank?.[itemId], 0);
const packOf = (state, itemId) => (state?.pack || []).reduce((sum, slot) => sum + (slot?.itemId === itemId ? num(slot.qty, 0) : 0), 0);
const ordersOf = state => Array.isArray(state?.orders) ? state.orders : [];
const routeOf = state => state?.route || null;

function send(message) {
  const session = gameSession();
  if (!session) return false;
  try {
    if (typeof session.post === 'function') { session.post(message); return true; }
    if (typeof session.intent === 'function') { session.intent(message, () => {}); return true; }
  } catch { return false; }
  return false;
}

/* ---------------------------- 自检更新 ---------------------------- */
const updateState = { latest: null, checkedAt: 0, failed: false };

function versionParts(value) {
  const parts = String(value ?? '').split('.').map(Number);
  return parts.length && parts.every(Number.isSafeInteger) ? parts : null;
}

function isNewer(candidate, current) {
  const a = versionParts(candidate), b = versionParts(current);
  if (!a || !b) return false;
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const left = a[index] ?? 0, right = b[index] ?? 0;
    if (left !== right) return left > right;
  }
  return false;
}

async function checkUpdate(force = false) {
  const cached = store.read(UPDATE_KEY, null);
  if (!force && cached && now() - num(cached.at) < UPDATE_TTL) {
    updateState.latest = cached.latest || null;
    updateState.checkedAt = num(cached.at);
    return updateState;
  }
  try {
    const response = await fetch(UPDATE_META + '?t=' + now(), { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const text = await response.text();
    const match = /\/\/\s*@version\s+(\S+)/.exec(text);
    const latest = match ? match[1] : null;
    updateState.latest = latest;
    updateState.checkedAt = now();
    updateState.failed = !latest;
    store.write(UPDATE_KEY, { at: updateState.checkedAt, latest });
  } catch {
    updateState.failed = true;
    updateState.checkedAt = now();
  }
  return updateState;
}

const updateAvailable = () => !!(updateState.latest && isNewer(updateState.latest, VERSION_LOCAL));
let VERSION_LOCAL = '0.0.0';

/* ------------------------------ 设置 ------------------------------ */
const DEFAULT_SETTINGS = {
  tab: 'profit',
  minProfit: 50e6,          // 利润下限：50m/h
  sellMode: 'instant',      // instant=吃买一，ask=压价挂单
  onlyUnlocked: true,
  includeCraft: true,
  includeGather: true,
  includeBonus: true,       // 额外掉落算进期望收益
  minVolume: 0,             // 日销量下限过滤（0=不过滤）
  autoBuy: true,            // 制造缺料自动买
  autoSell: true,           // 产物自动上架
  sellEvery: 20,            // 每 N 秒尝试卖一次
  batch: 200,               // 每次补料/卖出的批大小
  speedAdj: 1,              // 速度修正（1=按等级加成的理论值）
  targetSkill: 'mining',
  targetLevel: 70,
  ratio: 0,                 // 金币/小时预算；0=自动
  ratioAuto: true,
  x: null, y: null, collapsed: false,
  logLimit: 40
};
let settings = { ...DEFAULT_SETTINGS };
{
  const saved = store.read(PREF_KEY, null);
  if (saved && typeof saved === 'object') {
    for (const [key, value] of Object.entries(saved)) {
      if (!(key in DEFAULT_SETTINGS)) continue;
      if (typeof DEFAULT_SETTINGS[key] === 'number' ? Number.isFinite(value) : typeof value === typeof DEFAULT_SETTINGS[key]) settings[key] = value;
    }
  }
}
const saveSettings = () => store.write(PREF_KEY, settings);

// 实测校准：记录每个作业真实的“动作/小时”，用来修正速度估计
let calibration = store.read(CALIB_KEY, {}) || {};
const calibOf = jobId => num(calibration[jobId], 0);
function setCalib(jobId, actionsPerHour) {
  if (!(actionsPerHour > 0)) return;
  calibration[jobId] = Math.round(actionsPerHour);
  store.write(CALIB_KEY, calibration);
}
/* ===== model.js ===== */
/* =========================================================================
 * dvi-profit · model：作业经济模型（利润/小时）与升级规划
 * 时间口径与游戏一致：ticks/动作 = baseTicks / 速度，速度 = 1 + 0.5%×(等级-需求等级)
 * ========================================================================= */

const TAX_RATE = TAX_BP_DEFAULT / 10000;

function usableJob(job) {
  return !!job && !job.grow && !job.retired && !!job.siteId && (job.xp > 0 || job.gather);
}

// 每个动作需要的 tick 数
function ticksPerAction(job, level) {
  const speed = (1 + 0.005 * Math.max(0, num(level) - job.levelReq)) * Math.max(0.1, num(settings.speedAdj, 1));
  return Math.max(1e-6, job.baseTicks / speed);
}

// 动作/小时：有实测校准就直接用实测值（实测最准）
function actionsPerHour(job, level) {
  const measured = calibOf(job.id);
  if (measured > 0) return measured;
  return TICKS_PER_HOUR / ticksPerAction(job, level);
}

/**
 * 单个作业的经济模型。
 * @returns {{job, aph, xpPerHour, revenuePerHour, costPerHour, profitPerHour, revenuePerAction, costPerAction, profitPerAction, outQtyPerHour, sell, volPerDay, missing}}
 */
function jobEconomics(job, level, options = {}) {
  const sellMode = options.sellMode || settings.sellMode;
  const includeBonus = options.includeBonus !== undefined ? options.includeBonus : settings.includeBonus;
  const aph = actionsPerHour(job, level);

  let revenuePerAction = 0;
  let sell = 0;
  let outQtyPerHour = 0;
  if (job.outItem === COIN_ITEM) {
    // 偷窃摊位：直接给金币，没有税
    revenuePerAction = job.outQty;
    sell = 1;
    outQtyPerHour = job.outQty * aph;
  } else if (job.outItem) {
    sell = sellPriceOf(job.outItem, sellMode);
    revenuePerAction = job.outQty * sell * (1 - TAX_RATE);
    outQtyPerHour = job.outQty * aph;
  }
  if (includeBonus && job.bonusItem && job.bonusChance > 0) {
    revenuePerAction += job.bonusChance * sellPriceOf(job.bonusItem, sellMode) * (1 - TAX_RATE);
  }

  let costPerAction = 0;
  const missing = [];
  for (const input of job.inputs) {
    const price = buyPriceOf(input.itemId);
    if (!priceOf(input.itemId)) missing.push(input.itemId);
    costPerAction += input.qty * price;
  }

  const profitPerAction = revenuePerAction - costPerAction;
  const profitPerHour = profitPerAction * aph;
  const priceRow = priceOf(job.outItem);
  return {
    job, aph,
    level,
    xpPerHour: job.xp * aph,
    revenuePerAction, costPerAction, profitPerAction,
    revenuePerHour: revenuePerAction * aph,
    costPerHour: costPerAction * aph,
    profitPerHour,
    outQtyPerHour,
    sell,
    volPerDay: priceRow ? priceRow.vol7d / 7 : null,
    buyQty: priceRow ? priceRow.buyQty : null,
    missing
  };
}

/** 捡漏列表：按利润/小时从高到低 */
function profitList(state, options = {}) {
  const minProfit = options.minProfit !== undefined ? options.minProfit : settings.minProfit;
  const onlyUnlocked = options.onlyUnlocked !== undefined ? options.onlyUnlocked : settings.onlyUnlocked;
  const includeCraft = options.includeCraft !== undefined ? options.includeCraft : settings.includeCraft;
  const includeGather = options.includeGather !== undefined ? options.includeGather : settings.includeGather;
  const minVolume = options.minVolume !== undefined ? options.minVolume : settings.minVolume;
  const rows = [];
  for (const job of JOBS) {
    if (!usableJob(job)) continue;
    if (job.gather ? !includeGather : !includeCraft) continue;
    const level = state ? levelOf(state, job.skill) : 99;
    if (onlyUnlocked && job.levelReq > level) continue;
    const econ = jobEconomics(job, level, options);
    if (minVolume > 0) {
      const daily = econ.job.outItem === COIN_ITEM ? Infinity : (priceOf(job.outItem)?.vol7d || 0) / 7;
      if (daily < minVolume) continue;
    }
    if (econ.profitPerHour < minProfit) continue;
    rows.push(econ);
  }
  rows.sort((a, b) => b.profitPerHour - a.profitPerHour);
  return rows;
}

/** 某技能在某等级下可做的作业（含等级校验） */
function candidatesAt(skill, level) {
  return JOBS.filter(job => job.skill === skill && usableJob(job) && job.levelReq <= level);
}

/**
 * 指定技能、指定等级下 xp/小时最高的作业。
 * budget = 每小时愿意烧的金币上限：0 表示只想白嫖（成本 ≤ 0），Infinity 表示不限。
 */
function bestAt(skill, level, budget, options = {}) {
  let best = null;
  const cap = budget === undefined ? settings.ratio : budget;
  for (const job of candidatesAt(skill, level)) {
    const econ = jobEconomics(job, level, options);
    if (econ.xpPerHour <= 0) continue;
    if (Number.isFinite(cap) && econ.costPerHour > cap) continue;
    if (!best || econ.xpPerHour > best.xpPerHour) best = econ;
  }
  return best;
}

/**
 * 自动比值（金币/小时预算）：
 * 在当前等级候选里挑“性价比拐点”——取成本从低到高，找到第一个
 * 达到最高 xp/小时 85% 的方案，它的成本就是默认预算。
 */
function suggestRatio(skill, level, options = {}) {
  const rows = candidatesAt(skill, level).map(job => jobEconomics(job, level, options)).filter(e => e.xpPerHour > 0);
  if (!rows.length) return { ratio: 0, maxXp: 0, note: '当前等级没有可做作业' };
  rows.sort((a, b) => a.costPerHour - b.costPerHour || b.xpPerHour - a.xpPerHour);
  const maxXp = rows.reduce((max, row) => Math.max(max, row.xpPerHour), 0);
  const target = maxXp * 0.85;
  const pick = rows.find(row => row.xpPerHour >= target) || rows[rows.length - 1];
  const fastest = rows.reduce((best, row) => (row.xpPerHour > best.xpPerHour ? row : best), rows[0]);
  return {
    ratio: Math.max(0, Math.round(pick.costPerHour)),
    maxXp,
    pick,
    fastest,
    cheapest: rows[0],
    note: pick.costPerHour <= 0 ? '拐点方案不用花钱' : ''
  };
}

/**
 * 升级规划：从当前经验练到目标等级。
 * budget 是“每小时愿意烧多少金币”（金币/小时），越大越快。
 * @returns {{bands, totalHours, totalGold, totalXp, endLevel, blocked, cheapest}}
 */
function buildPlan(state, skill, targetLevel, budget, options = {}) {
  const startXp = xpOf(state, skill);
  const startLevel = levelAtXp(startXp);
  const target = clamp(Math.round(targetLevel), 1, MAX_LEVEL);
  const bands = [];
  let totalHours = 0, totalGold = 0, totalXp = 0;
  let blocked = null;

  for (let level = startLevel; level < target; level++) {
    const best = bestAt(skill, level, budget, options);
    if (!best) { blocked = `Lv${level} 没有符合预算的作业`; break; }
    const need = xpAtLevel(level + 1) - xpAtLevel(level);
    const hours = need / best.xpPerHour;
    const last = bands[bands.length - 1];
    if (last && last.jobId === best.job.id) {
      last.to = level + 1;
      last.hours += hours;
      last.gold += best.costPerHour * hours;
      last.xp += need;
    } else {
      bands.push({
        jobId: best.job.id,
        from: level, to: level + 1,
        xpPerHour: best.xpPerHour,
        costPerHour: best.costPerHour,
        profitPerHour: best.profitPerHour,
        hours, gold: best.costPerHour * hours, xp: need
      });
    }
    totalHours += hours;
    totalGold += best.costPerHour * hours;
    totalXp += need;
  }

  return {
    skill, startLevel, target, bands, totalHours, totalGold, totalXp, blocked,
    endLevel: bands.length ? bands[bands.length - 1].to : startLevel
  };
}

// 计划里当前该做哪一段
function bandAtLevel(plan, level) {
  return plan.bands.find(band => level >= band.from && level < band.to) || null;
}
/* ===== runner.js ===== */
/* =========================================================================
 * dvi-profit · runner：自动挂机（挂任务 + 补料 + 卖货）
 * 协议：{t:'setRoute'} 开始挂机，{t:'marketSell'} 卖，{t:'marketBuy'} 买，{t:'skip'} 停
 * ========================================================================= */

const runner = {
  mode: null,          // 'profit' | 'level'
  running: false,
  jobId: null,
  skill: null,
  targetLevel: 0,
  plan: null,
  startedAt: 0,
  status: '待开始',
  sellAt: 0,
  routeSetAt: 0,
  restarts: 0,
  restartAt: 0,
  planLevel: 0,
  switchAt: 0,
  counters: { sold: 0, earned: 0, spent: 0, made: 0 },
  lastSample: null,
  history: []
};

function logLine(text) {
  runner.status = text;
  const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  runner.history.unshift(`${stamp} ${text}`);
  if (runner.history.length > settings.logLimit) runner.history.length = settings.logLimit;
  if (typeof uiPainter === 'function') uiPainter();
}

let activeEpoch = 0;

function stopRunner(reason = '已停止') {
  if (runner.running) logLine(reason);
  runner.running = false;
  runner.mode = null;
  activeEpoch++;
  if (typeof uiPainter === 'function') uiPainter();
}

async function waitUntil(predicate, timeout, step = 200) {
  const deadline = now() + timeout;
  while (now() < deadline) {
    if (predicate()) return true;
    await sleep(step);
  }
  return predicate();
}

/* --------------------------- 基础动作 --------------------------- */

// 开始挂机；limit=0 表示“无尽”，游戏里对应 amount 0 + endless
async function startRoute(job, epoch) {
  const state = gameState();
  if (!state) return '会话未就绪';
  if (!(levelOf(state, job.skill) >= job.levelReq)) return `等级不足（需要 Lv${job.levelReq}）`;
  if (!job.siteId) return '该作业没有可挂的工作点';
  const route = routeOf(state);
  if (route && route.jobId !== job.id) {
    send({ t: 'skip' });
    await waitUntil(() => !routeOf(gameState()), 8000);
  }
  const limits = [0, 100000, 10000];
  for (const limit of limits) {
    if (!runner.running || epoch !== activeEpoch) return '已取消';
    send({ t: 'setRoute', siteId: job.siteId, jobId: job.id, onFull: 'bank', limit });
    const ok = await waitUntil(() => {
      const live = gameState();
      const current = routeOf(live);
      return !!current && current.jobId === job.id;
    }, 6000);
    if (ok) return null;
  }
  return '游戏拒绝了开始挂机（工作点不匹配或该作业已下架）';
}

// 卖：先吃买一（立刻成交），没有买盘就压卖一挂单
async function sellItem(itemId, qty, epoch) {
  if (!(qty > 0)) return { ok: true, sold: 0 };
  const before = stockOf(gameState(), itemId, true);
  const coinsBefore = coinsOf(gameState());
  const ordersBefore = ordersOf(gameState()).length;
  const instant = sellPriceOf(itemId, 'instant');
  const ask = sellPriceOf(itemId, 'ask');
  // 买一价明显低于卖一（差价 <5%）时优先挂卖单，避免被低价吃掉
  const row = priceOf(itemId);
  const useInstant = row && row.highestBuy > 0 && row.highestBuy >= row.lowestSell * 0.95;
  const price = itemId === COIN_ITEM ? 1 : (useInstant ? instant : ask);
  send({ t: 'marketSell', itemId, qty, price });
  const filled = await waitUntil(() => {
    const state = gameState();
    if (!state) return false;
    if (stockOf(state, itemId, true) < before) return true;
    return ordersOf(state).length > ordersBefore;
  }, 8000, 250);
  if (!filled) return { ok: false, sold: 0 };
  const state = gameState();
  const soldQty = Math.max(0, before - stockOf(state, itemId, true));
  const gained = Math.max(0, coinsOf(state) - coinsBefore);
  return { ok: true, sold: soldQty, gained };
}

// 买：吃卖一价补料
async function buyItem(itemId, qty, epoch) {
  if (!(qty > 0)) return { ok: true, bought: 0 };
  const before = stockOf(gameState(), itemId, true);
  const price = buyPriceOf(itemId);
  send({ t: 'marketBuy', itemId, qty, price });
  const filled = await waitUntil(() => stockOf(gameState(), itemId, true) > before, 9000, 250);
  if (!filled) return { ok: false, bought: 0 };
  return { ok: true, bought: stockOf(gameState(), itemId, true) - before, price };
}

/* --------------------------- 自动补料 --------------------------- */
async function ensureMaterials(job, epoch) {
  if (!settings.autoBuy || !job.inputs.length) return null;
  const state = gameState();
  if (!state) return '会话未就绪';
  const batch = Math.max(10, Math.round(settings.batch));
  for (const input of job.inputs) {
    const need = input.qty * batch;
    const have = stockOf(state, input.itemId, true);
    if (have >= need) continue;
    const shortage = need - have;
    const price = buyPriceOf(input.itemId);
    const cost = shortage * price;
    if (coinsOf(state) < cost) return `金币不足：补 ${itemName(input.itemId)} ×${fmtInt(shortage)} 需要 ${fmtGold(cost)}`;
    const result = await buyItem(input.itemId, shortage, epoch);
    if (!result.ok) return `补料失败：${itemName(input.itemId)} ×${fmtInt(shortage)}（可在市场手动买）`;
    runner.counters.spent += result.bought * price;
    logLine(`补料 ${itemName(input.itemId)} ×${fmtInt(result.bought)}，单价 ${fmtGold(price)}`);
  }
  return null;
}

/* --------------------------- 自动卖货 --------------------------- */
let sellCapability = 'unknown';   // unknown | ok | blocked

async function sellSurplus(job, epoch) {
  if (!settings.autoSell) return;
  if (sellCapability === 'blocked') return;
  const state = gameState();
  if (!state) return;
  const targets = new Map();
  const addTarget = itemId => {
    if (!itemId || itemId === COIN_ITEM) return;
    const have = bankOf(state, itemId) + packOf(state, itemId);
    if (have > 0) targets.set(itemId, Math.min(have, Math.max(1, Math.round(settings.batch))));
  };
  addTarget(job.outItem);
  if (job.bonusItem) addTarget(job.bonusItem);

  for (const [itemId, qty] of targets) {
    const result = await sellItem(itemId, qty, epoch);
    if (!result.ok) {
      sellCapability = 'blocked';
      logLine('卖出未被服务器接受：请走到市场柜台（或先手动打开一次市场）再继续；库存已保留在仓库');
      return;
    }
    sellCapability = 'ok';
    runner.counters.sold += result.sold;
    runner.counters.earned += result.gained;
  }
}

/* --------------------------- 校准动作速率 --------------------------- */
function sampleRate(job) {
  const state = gameState();
  if (!state || !job.outItem || job.outQty <= 0) return;
  const stock = stockOf(state, job.outItem, true);
  const sample = runner.lastSample;
  if (!sample || sample.jobId !== job.id) {
    runner.lastSample = { jobId: job.id, at: now(), stock };
    return;
  }
  const elapsed = now() - sample.at;
  if (elapsed < 120000 || stock <= sample.stock) return;
  const actions = (stock - sample.stock) / job.outQty;
  const perHour = actions / (elapsed / 3600000);
  if (perHour > 0 && Number.isFinite(perHour)) setCalib(job.id, perHour);
  runner.lastSample = { jobId: job.id, at: now(), stock };
}

/* --------------------------- 主循环 --------------------------- */
async function runnerTick() {
  if (!runner.running) return;
  const epoch = activeEpoch;
  const state = gameState();
  if (!state) { runner.status = '等待游戏连接…'; if (typeof uiPainter === 'function') uiPainter(); return; }

  let job = runner.jobId ? JOB_BY_ID.get(runner.jobId) : null;

  if (runner.mode === 'level') {
    const level = levelOf(state, runner.skill);
    if (level >= runner.targetLevel) {
      stopRunner(`已达成 ${skillZh(runner.skill)} Lv${runner.targetLevel}`);
      return;
    }
    if (!runner.plan || runner.planLevel !== level || !bandAtLevel(runner.plan, level)) {
      runner.plan = buildPlan(state, runner.skill, runner.targetLevel, budgetOf());
      runner.planLevel = level;
    }
    const band = bandAtLevel(runner.plan, level);
    if (!band) { stopRunner('规划失败：当前等级没有符合预算的作业'); return; }
    job = JOB_BY_ID.get(band.jobId);
    if (!job) { stopRunner('作业数据缺失'); return; }
    if (job.id !== runner.jobId) {
      runner.jobId = job.id;
      runner.restarts = 0;
      logLine(`切换到 ${job.zh}（Lv${level}→${runner.targetLevel}）`);
    }
  }

  if (!job) { stopRunner('没有目标作业'); return; }

  // 捡漏模式：每 5 分钟对比一次，发现明显更赚的就换
  if (runner.mode === 'profit' && now() > runner.switchAt) {
    runner.switchAt = now() + 300000;
    const rows = profitList(state, {});
    const leader = rows[0];
    if (leader && leader.job.id !== job.id && leader.profitPerHour > (jobEconomics(job, levelOf(state, job.skill)).profitPerHour * 1.3)) {
      logLine(`发现更赚的 ${leader.job.zh}（${fmtGold(leader.profitPerHour)}/h），切换`);
      runner.jobId = leader.job.id;
      job = leader.job;
    }
  }

  const error = await ensureMaterials(job, epoch);
  if (error) { stopRunner(error); return; }
  if (!runner.running || epoch !== activeEpoch) return;

  const live = gameState();
  const route = routeOf(live);
  if (!route || route.jobId !== job.id) {
    if (now() - runner.restartAt > 120000) runner.restarts = 0;
    if (++runner.restarts > 8) {
      stopRunner('反复被游戏停下（多半是材料没备够或仓库满了），已暂停');
      return;
    }
    runner.restartAt = now();
    const failure = await startRoute(job, epoch);
    if (failure) { stopRunner(failure); return; }
    logLine(`开始 ${job.zh}（${skillZh(job.skill)} Lv${job.levelReq}）`);
  }

  if (settings.autoSell && now() >= runner.sellAt) {
    runner.sellAt = now() + Math.max(5, settings.sellEvery) * 1000;
    await sellSurplus(job, epoch);
  }

  sampleRate(job);

  const current = levelOf(live, job.skill);
  const econ = jobEconomics(job, current);
  runner.status = runner.mode === 'level'
    ? `练级中 ${skillZh(job.skill)} Lv${current} → ${runner.targetLevel}：${job.zh}`
    : `捡漏中 ${job.zh}：${fmtGold(econ.profitPerHour)} 金币/小时`;
  if (typeof uiPainter === 'function') uiPainter();
}

/* --------------------------- 启动入口 --------------------------- */
function budgetOf() {
  if (settings.ratioAuto) return num(autoRatio.value, 0);
  const value = Math.max(0, num(settings.ratio, 0));
  return value >= 1e9 ? Infinity : value;
}

const autoRatio = { value: 0 };

function startProfit(jobId) {
  const state = gameState();
  const job = JOB_BY_ID.get(jobId);
  if (!state || !job) return;
  stopRunner('切换模式');
  runner.mode = 'profit';
  runner.jobId = jobId;
  runner.running = true;
  activeEpoch++;
  runner.startedAt = now();
  runner.switchAt = now() + 300000;
  runner.sellAt = 0;
  runner.counters = { sold: 0, earned: 0, spent: 0, made: 0 };
  runner.lastSample = null;
  logLine(`开始捡漏：${job.zh}`);
  tickLoop();
}

function startLevel() {
  const state = gameState();
  if (!state) return;
  const skill = settings.targetSkill;
  const plan = buildPlan(state, skill, settings.targetLevel, budgetOf());
  if (!plan.bands.length) {
    logLine(plan.blocked || '没有可执行的计划');
    return;
  }
  stopRunner('切换模式');
  runner.mode = 'level';
  runner.skill = skill;
  runner.targetLevel = plan.target;
  runner.plan = plan;
  runner.jobId = JOB_BY_ID.get(plan.bands[0].jobId)?.id || null;
  runner.running = true;
  activeEpoch++;
  runner.startedAt = now();
  runner.sellAt = 0;
  runner.counters = { sold: 0, earned: 0, spent: 0, made: 0 };
  runner.lastSample = null;
  logLine(`开始练级：${skillZh(skill)} → Lv${plan.target}，预计 ${fmtDuration(plan.totalHours)}`);
  tickLoop();
}

function pauseRunner() {
  const session = gameSession();
  if (session && routeOf(session.state)) send({ t: 'skip' });
  stopRunner('已暂停（游戏内挂机已停止）');
}

/* 后台不被节流：worker 里打点，同时把页面伪装成“可见” */
let tickTimer = null;
let clockWorker = null;
function startClock() {
  if (tickTimer) return;
  tickTimer = setInterval(() => { runnerTick().catch(error => logLine('运行出错：' + (error.message || error))); }, 1000);
  try {
    const url = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 1000)'], { type: 'text/javascript' }));
    clockWorker = new Worker(url);
    URL.revokeObjectURL(url);
    clockWorker.onmessage = () => { runnerTick().catch(error => logLine('运行出错：' + (error.message || error))); };
  } catch { /* 没有 Worker 也能跑，只是后台可能被节流 */ }
}
function tickLoop() { startClock(); }
/* ===== ui.js ===== */
/* =========================================================================
 * dvi-profit · ui：双面板界面（捡漏 / 快速升级）
 * ========================================================================= */

function uiPainter() { if (paintStatus) paintStatus(); }
let paintStatus = null;
let panelHost = null;
let shadow = null;
let dom = {};
let refreshTimer = null;

const CSS = `
:host { all: initial; }
.wrap {
  --bg: #10131a; --bg2: #161b25; --line: #252d3b; --ink: #dbe3f0; --dim: #8b97ac;
  --good: #38d39f; --warn: #f2c94c; --bad: #ff6b7a; --acc: #4d9dff;
  position: fixed; z-index: 2147483000; width: 780px; max-width: calc(100vw - 24px);
  background: var(--bg); color: var(--ink); border: 1px solid var(--line); border-radius: 12px;
  box-shadow: 0 18px 48px rgba(0,0,0,.55); font: 12px/1.5 "Segoe UI", "Microsoft YaHei", sans-serif;
  overflow: hidden; user-select: none;
}
.head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: var(--bg2); cursor: move; border-bottom: 1px solid var(--line); }
.head b { font-size: 13px; letter-spacing: .3px; }
.head .dot { width: 8px; height: 8px; border-radius: 50%; background: #4b5568; }
.head .dot.on { background: var(--good); box-shadow: 0 0 8px var(--good); }
.head .grow { flex: 1; }
.head button { background: #1e2634; color: var(--ink); border: 1px solid var(--line); border-radius: 6px; padding: 2px 8px; cursor: pointer; font: inherit; }
.head button:hover { border-color: var(--acc); }
.tabs { display: flex; gap: 4px; padding: 6px 10px 0; background: var(--bg2); }
.tabs button { flex: 1; padding: 6px 8px; background: transparent; color: var(--dim); border: 1px solid transparent; border-bottom: none; border-radius: 8px 8px 0 0; cursor: pointer; font: inherit; }
.tabs button.sel { background: var(--bg); color: var(--ink); border-color: var(--line); }
.body { padding: 10px; max-height: min(66vh, 640px); overflow: auto; }
.row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
label.chk { display: inline-flex; align-items: center; gap: 4px; color: var(--dim); cursor: pointer; }
input[type=text], input[type=number], select {
  background: #0c0f15; color: var(--ink); border: 1px solid var(--line); border-radius: 6px;
  padding: 3px 6px; font: inherit; outline: none;
}
input[type=text]:focus, input[type=number]:focus, select:focus { border-color: var(--acc); }
input[type=range] { width: 190px; accent-color: var(--acc); }
button.act { background: #1b2430; color: var(--ink); border: 1px solid var(--line); border-radius: 6px; padding: 3px 10px; cursor: pointer; font: inherit; }
button.act:hover { border-color: var(--acc); }
button.act.primary { background: #1d3category; }
button.act.primary:hover { background: #1d4f86; }
button.act.go { background: #17364a; border-color: #2b5f7d; }
button.act.go:hover { background: #1d4761; }
button.act:disabled { opacity: .45; cursor: default; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 3px 6px; border-bottom: 1px solid #1a212c; white-space: nowrap; }
th { color: var(--dim); font-weight: 600; position: sticky; top: 0; background: var(--bg); }
td.num, th.num { text-align: right; }
tr.pick td { background: #16202b; }
.good { color: var(--good); }
.bad { color: var(--bad); }
.dim { color: var(--dim); }
.warn { color: var(--warn); }
.foot { border-top: 1px solid var(--line); padding: 6px 10px; background: var(--bg2); display: flex; gap: 8px; align-items: center; }
.logs { max-height: 88px; overflow: auto; color: var(--dim); font-size: 11px; padding: 0 10px 8px; }
.logs div { padding: 1px 0; }
.hint { color: var(--dim); font-size: 11px; }
.sum { display: flex; gap: 14px; flex-wrap: wrap; margin: 6px 0 8px; }
.sum span b { color: var(--ink); }
.badge { border: 1px solid var(--line); border-radius: 999px; padding: 0 6px; color: var(--dim); font-size: 11px; }
`;

function ensurePanel() {
  if (panelHost) return;
  panelHost = document.createElement('div');
  panelHost.id = 'dvi-profit';
  document.documentElement.appendChild(panelHost);
  shadow = panelHost.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${CSS.replace('#1d3category', '#1d3a52')}</style><div class="wrap" data-wrap>
    <div class="head" data-head>
      <span class="dot" data-dot></span>
      <b>DVI 捡漏 + 练级</b>
      <span class="grow"></span>
      <button data-update hidden title="发现新版本，点这里安装">新版</button>
      <span class="dim" data-clock></span>
      <button data-collapse>收起</button>
    </div>
    <div data-main>
      <div class="tabs">
        <button data-tab="profit" class="sel">捡漏模式</button>
        <button data-tab="level">快速升级</button>
      </div>
      <div class="body">
        <div data-pane="profit"></div>
        <div data-pane="level" hidden></div>
      </div>
      <div class="logs" data-logs></div>
      <div class="foot">
        <span data-status class="dim">待开始</span>
        <span class="grow" style="flex:1"></span>
        <button class="act" data-pause>暂停</button>
      </div>
    </div>
  </div>`;

  dom = {
    wrap: shadow.querySelector('[data-wrap]'),
    head: shadow.querySelector('[data-head]'),
    dot: shadow.querySelector('[data-dot]'),
    clock: shadow.querySelector('[data-clock]'),
    main: shadow.querySelector('[data-main]'),
    collapse: shadow.querySelector('[data-collapse]'),
    updateBtn: shadow.querySelector('[data-update]'),
    tabProfit: shadow.querySelector('[data-tab="profit"]'),
    tabLevel: shadow.querySelector('[data-tab="level"]'),
    paneProfit: shadow.querySelector('[data-pane="profit"]'),
    paneLevel: shadow.querySelector('[data-pane="level"]'),
    logs: shadow.querySelector('[data-logs]'),
    status: shadow.querySelector('[data-status]'),
    pause: shadow.querySelector('[data-pause]')
  };
  buildProfitPane();
  buildLevelPane();
  bindPanel();
  paintStatus = () => {
    if (!dom.status) return;
    dom.status.textContent = runner.status;
    if (dom.updateBtn) {
      const has = updateAvailable();
      dom.updateBtn.hidden = !has;
      if (has) dom.updateBtn.textContent = `新版 ${updateState.latest}`;
    }
    dom.dot.classList.toggle('on', runner.running);
    dom.clock.textContent = isLive() ? '在线' : '离线';
    const logs = runner.history.slice(0, 6).map(line => `<div>${escapeHtml(line)}</div>`).join('');
    if (dom.logs.innerHTML !== logs) dom.logs.innerHTML = logs;
  };
  if (settings.collapsed) toggleCollapse(true);
  placePanel();
  paintStatus();
}

const escapeHtml = text => String(text).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

function placePanel() {
  if (!dom.wrap) return;
  const x = Number.isFinite(settings.x) ? settings.x : Math.max(12, window.innerWidth - 800);
  const y = Number.isFinite(settings.y) ? settings.y : 70;
  dom.wrap.style.left = clamp(x, 0, Math.max(0, window.innerWidth - 240)) + 'px';
  dom.wrap.style.top = clamp(y, 0, Math.max(0, window.innerHeight - 80)) + 'px';
  dom.wrap.style.right = 'auto';
}

function toggleCollapse(force) {
  const collapsed = force !== undefined ? force : !settings.collapsed;
  settings.collapsed = collapsed;
  saveSettings();
  if (dom.main) dom.main.hidden = collapsed;
  if (dom.collapse) dom.collapse.textContent = collapsed ? '展开' : '收起';
}

function bindPanel() {
  let drag = null;
  dom.head.addEventListener('pointerdown', event => {
    if (event.target.closest('button')) return;
    const rect = dom.wrap.getBoundingClientRect();
    drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
    dom.head.setPointerCapture(event.pointerId);
  });
  dom.head.addEventListener('pointermove', event => {
    if (!drag) return;
    settings.x = clamp(event.clientX - drag.dx, -40, window.innerWidth - 120);
    settings.y = clamp(event.clientY - drag.dy, 0, window.innerHeight - 60);
    dom.wrap.style.left = settings.x + 'px';
    dom.wrap.style.top = settings.y + 'px';
  });
  dom.head.addEventListener('pointerup', event => {
    if (!drag) return;
    drag = null;
    dom.head.releasePointerCapture(event.pointerId);
    saveSettings();
  });
  dom.collapse.addEventListener('click', () => toggleCollapse());
  dom.tabProfit.addEventListener('click', () => selectTab('profit'));
  dom.tabLevel.addEventListener('click', () => selectTab('level'));
  dom.pause.addEventListener('click', () => pauseRunner());
  dom.updateBtn.addEventListener('click', () => {
    // 直接打开脚本地址，油猴会弹安装/更新确认
    window.open(UPDATE_PAGE, '_blank', 'noopener');
  });
}

function selectTab(tab) {
  settings.tab = tab;
  saveSettings();
  dom.tabProfit.classList.toggle('sel', tab === 'profit');
  dom.tabLevel.classList.toggle('sel', tab === 'level');
  dom.paneProfit.hidden = tab !== 'profit';
  dom.paneLevel.hidden = tab !== 'level';
  if (tab === 'profit') renderProfit();
  else renderLevel();
}

/* ------------------------------ 捡漏面板 ------------------------------ */
function buildProfitPane() {
  dom.paneProfit.innerHTML = `
    <div class="row">
      <label>利润下限</label>
      <input type="text" data-min profit style="width:110px" placeholder="50m">
      <span class="dim">金币/小时</span>
      <label class="chk"><input type="checkbox" data-only-unlocked> 只看已解锁</label>
      <label class="chk"><input type="checkbox" data-gather> 采集</label>
      <label class="chk"><input type="checkbox" data-craft> 制造</label>
      <label class="chk"><input type="checkbox" data-bonus> 算额外掉落</label>
      <label>速度修正 ×</label>
      <input type="number" data-speed min="0.2" max="3" step="0.05" style="width:64px">
      <span style="flex:1"></span>
      <button class="act" data-refresh>刷新市场价</button>
    </div>
    <div class="row hint" data-price-note>市场价：等待加载…</div>
    <table>
      <colgroup><col style="width:22%"><col style="width:10%"><col style="width:8%"><col style="width:12%"><col style="width:11%"><col style="width:14%"><col style="width:8%"><col style="width:9%"><col style="width:6%"></colgroup>
      <thead><tr>
        <th>作业</th><th>技能</th><th class="num">需等级</th>
        <th class="num">利润/时</th><th class="num">成本/时</th><th class="num">产出/时</th>
        <th class="num">单价</th><th class="num">日销量</th><th></th>
      </tr></thead>
      <tbody data-profit-rows></tbody>
    </table>
    <div class="hint" data-profit-empty hidden>没有达到利润下限的项目：把下限调低，或关掉“只看已解锁”。</div>
  `;
  dom.minProfit = dom.paneProfit.querySelector('[data-min]');
  dom.onlyUnlocked = dom.paneProfit.querySelector('[data-only-unlocked]');
  dom.gatherChk = dom.paneProfit.querySelector('[data-gather]');
  dom.craftChk = dom.paneProfit.querySelector('[data-craft]');
  dom.bonusChk = dom.paneProfit.querySelector('[data-bonus]');
  dom.speedInput = dom.paneProfit.querySelector('[data-speed]');
  dom.refreshBtn = dom.paneProfit.querySelector('[data-refresh]');
  dom.profitRows = dom.paneProfit.querySelector('[data-profit-rows]');
  dom.profitEmpty = dom.paneProfit.querySelector('[data-profit-empty]');
  dom.priceNote = dom.paneProfit.querySelector('[data-price-note]');

  dom.minProfit.value = shortGold(settings.minProfit);
  dom.onlyUnlocked.checked = settings.onlyUnlocked;
  dom.gatherChk.checked = settings.includeGather;
  dom.craftChk.checked = settings.includeCraft;
  dom.bonusChk.checked = settings.includeBonus;
  dom.speedInput.value = String(settings.speedAdj);

  dom.minProfit.addEventListener('change', () => {
    settings.minProfit = parseGold(dom.minProfit.value, settings.minProfit);
    dom.minProfit.value = shortGold(settings.minProfit);
    saveSettings(); renderProfit();
  });
  for (const [element, key] of [[dom.onlyUnlocked, 'onlyUnlocked'], [dom.gatherChk, 'includeGather'], [dom.craftChk, 'includeCraft'], [dom.bonusChk, 'includeBonus']]) {
    element.addEventListener('change', () => { settings[key] = element.checked; saveSettings(); renderProfit(); });
  }
  dom.speedInput.addEventListener('change', () => {
    settings.speedAdj = clamp(num(Number(dom.speedInput.value), 1), 0.2, 3);
    dom.speedInput.value = String(settings.speedAdj);
    saveSettings(); renderProfit();
  });
  dom.refreshBtn.addEventListener('click', async () => {
    dom.refreshBtn.disabled = true;
    await loadPrices(true);
    dom.refreshBtn.disabled = false;
    renderProfit();
  });
  dom.profitRows.addEventListener('click', event => {
    const button = event.target.closest('button[data-start]');
    if (!button) return;
    startProfit(Number(button.dataset.start));
  });
}

function shortGold(value) {
  const v = num(value);
  if (v >= 1e9) return (v / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'b';
  if (v >= 1e6) return (v / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'm';
  if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.?0+$/, '') + 'k';
  return String(Math.round(v));
}

function renderProfit() {
  if (!dom.profitRows) return;
  const state = gameState();
  const rows = profitList(state, {});
  const stamp = priceData.at ? new Date(priceData.at).toLocaleTimeString('zh-CN', { hour12: false }) : '—';
  const calibrated = Object.keys(calibration).length;
  const base = priceData.error
    ? `市场价读取失败：${priceData.error}（用物品基础价值兜底）`
    : `市场价 ${stamp} 更新 · 共 ${Object.keys(priceData.items).length} 条 · 卖出：${settings.sellMode === 'instant' ? '吃买一' : '压价挂单'} · 税 2%`;
  const note = `${base} · 速度修正 ×${settings.speedAdj}${calibrated ? ` · 已实测校准 ${calibrated} 个作业` : ' · 挂机满 2 分钟会自动实测校准'}`;
  dom.priceNote.textContent = note;

  if (!rows.length) {
    dom.profitRows.innerHTML = '';
    dom.profitEmpty.hidden = false;
    return;
  }
  dom.profitEmpty.hidden = true;
  const current = runner.mode === 'profit' ? runner.jobId : null;
  const html = rows.slice(0, 60).map(row => {
    const job = row.job;
    const locked = state ? job.levelReq > levelOf(state, job.skill) : false;
    const vol = row.job.outItem === COIN_ITEM ? '金币' : (row.volPerDay === null ? '—' : fmtInt(row.volPerDay));
    const priceLabel = job.outItem === COIN_ITEM ? '1' : fmtGold(row.sell);
    const outPerHour = job.outItem === COIN_ITEM ? fmtGold(row.outQtyPerHour) : `${fmtInt(row.outQtyPerHour)} ${itemName(job.outItem)}`;
    return `<tr class="${job.id === current ? 'pick' : ''}">
      <td title="${escapeHtml(job.name)}">${escapeHtml(job.zh)}</td>
      <td class="dim">${skillZh(job.skill)}</td>
      <td class="num ${locked ? 'bad' : ''}">${job.levelReq}</td>
      <td class="num good">${fmtGold(row.profitPerHour)}</td>
      <td class="num ${row.costPerHour > 0 ? 'warn' : 'dim'}">${row.costPerHour > 0 ? fmtGold(row.costPerHour) : '0'}</td>
      <td class="num dim">${outPerHour}</td>
      <td class="num dim">${priceLabel}</td>
      <td class="num dim">${vol}</td>
      <td><button class="act go" data-start="${job.id}" ${locked ? 'disabled' : ''}>${job.id === current ? '进行中' : '开始'}</button></td>
    </tr>`;
  }).join('');
  dom.profitRows.innerHTML = html;
}

/* ------------------------------ 升级面板 ------------------------------ */
function buildLevelPane() {
  dom.paneLevel.innerHTML = `
    <div class="row">
      <label>技能</label>
      <select data-skill>${WORK_SKILLS.map(skill => `<option value="${skill}">${skillZh(skill)}</option>`).join('')}</select>
      <label>目标等级</label>
      <input type="number" data-target min="2" max="200" style="width:70px">
      <span class="dim" data-current></span>
    </div>
    <div class="row">
      <label>金币/小时预算</label>
      <input type="range" data-ratio min="0" max="100" step="1">
      <input type="text" data-ratio-text style="width:96px">
      <label class="chk"><input type="checkbox" data-ratio-auto> 自动（推荐）</label>
      <span class="hint" data-ratio-note></span>
    </div>
    <div class="sum" data-sum></div>
    <table>
      <thead><tr>
        <th>等级段</th><th>作业</th><th class="num">经验/时</th><th class="num">金币/时</th><th class="num">时长</th><th class="num">花费</th>
      </tr></thead>
      <tbody data-plan-rows></tbody>
    </table>
    <div class="row" style="margin-top:8px">
      <button class="act go" data-level-start>开始练级</button>
      <span class="hint">预算越高越快、越烧钱；自动值 = 当前等级“性价比拐点”（达到最高经验 85% 的最低预算）</span>
    </div>
  `;
  dom.skillSel = dom.paneLevel.querySelector('[data-skill]');
  dom.targetInput = dom.paneLevel.querySelector('[data-target]');
  dom.ratioRange = dom.paneLevel.querySelector('[data-ratio]');
  dom.ratioText = dom.paneLevel.querySelector('[data-ratio-text]');
  dom.ratioAuto = dom.paneLevel.querySelector('[data-ratio-auto]');
  dom.ratioNote = dom.paneLevel.querySelector('[data-ratio-note]');
  dom.sum = dom.paneLevel.querySelector('[data-sum]');
  dom.planRows = dom.paneLevel.querySelector('[data-plan-rows]');
  dom.levelStart = dom.paneLevel.querySelector('[data-level-start]');
  dom.current = dom.paneLevel.querySelector('[data-current]');

  dom.skillSel.value = settings.targetSkill;
  dom.targetInput.value = settings.targetLevel;
  dom.ratioAuto.checked = settings.ratioAuto;

  dom.skillSel.addEventListener('change', () => {
    settings.targetSkill = dom.skillSel.value;
    settings.ratioAuto = true;
    dom.ratioAuto.checked = true;
    saveSettings(); renderLevel();
  });
  dom.targetInput.addEventListener('change', () => {
    settings.targetLevel = clamp(Math.round(num(Number(dom.targetInput.value), 70)), 2, MAX_LEVEL);
    dom.targetInput.value = settings.targetLevel;
    saveSettings(); renderLevel();
  });
  dom.ratioAuto.addEventListener('change', () => {
    settings.ratioAuto = dom.ratioAuto.checked;
    saveSettings(); renderLevel();
  });
  dom.ratioRange.addEventListener('input', () => {
    settings.ratioAuto = false;
    dom.ratioAuto.checked = false;
    settings.ratio = rangeToGold(Number(dom.ratioRange.value));
    dom.ratioText.value = shortGold(settings.ratio);
    saveSettings(); renderLevel();
  });
  dom.ratioText.addEventListener('change', () => {
    settings.ratio = parseGold(dom.ratioText.value, settings.ratio);
    settings.ratioAuto = false;
    dom.ratioAuto.checked = false;
    dom.ratioText.value = shortGold(settings.ratio);
    saveSettings(); renderLevel();
  });
  dom.levelStart.addEventListener('click', () => startLevel());
}

// 滑块 0..100：0=只想白嫖，1..99 走指数刻度（10^5 → 10^8.96），100=不限
const rangeToGold = value => {
  if (value <= 0) return 0;
  if (value >= 100) return Infinity;
  return Math.round(Math.pow(10, 5 + value * 0.04));
};
const goldToRange = value => {
  if (!(value > 0)) return 0;
  if (!Number.isFinite(value)) return 100;
  return clamp(Math.round((Math.log10(value) - 5) / 0.04), 1, 99);
};

function renderLevel() {
  if (!dom.planRows) return;
  const state = gameState();
  const skill = settings.targetSkill;
  const level = state ? levelOf(state, skill) : 1;
  const suggestion = state ? suggestRatio(skill, level) : { ratio: 0, maxXp: 0 };
  if (settings.ratioAuto) {
    autoRatio.value = suggestion.ratio;
    settings.ratio = suggestion.ratio;
  } else autoRatio.value = settings.ratio;

  dom.current.textContent = state ? `当前 ${skillZh(skill)} Lv${level}（${fmtInt(xpOf(state, skill))} 经验）` : '未连接';
  dom.ratioRange.value = String(goldToRange(settings.ratioAuto ? suggestion.ratio : settings.ratio));
  dom.ratioText.value = shortGold(settings.ratioAuto ? suggestion.ratio : settings.ratio);
  dom.ratioRange.disabled = settings.ratioAuto;
  dom.ratioText.disabled = settings.ratioAuto;
  dom.ratioNote.textContent = suggestion.maxXp
    ? `该等级最高 ${fmtInt(suggestion.maxXp)} 经验/时${settings.ratioAuto ? `，自动预算 ${shortGold(suggestion.ratio)}/时` : ''}`
    : '';

  if (!state) {
    dom.planRows.innerHTML = '';
    dom.sum.innerHTML = '<span class="warn">等待游戏连接…</span>';
    return;
  }

  const budget = settings.ratioAuto ? suggestion.ratio : settings.ratio;
  const plan = buildPlan(state, skill, settings.targetLevel, budget);
  dom.planRows.innerHTML = plan.bands.slice(0, 40).map(band => {
    const job = JOB_BY_ID.get(band.jobId);
    return `<tr>
      <td>Lv${band.from} → ${band.to}</td>
      <td>${job ? escapeHtml(job.zh) : '#' + band.jobId}</td>
      <td class="num">${fmtInt(band.xpPerHour)}</td>
      <td class="num ${band.costPerHour > 0 ? 'warn' : 'good'}">${band.costPerHour > 0 ? fmtGold(band.costPerHour) : '赚钱'}</td>
      <td class="num dim">${fmtDuration(band.hours)}</td>
      <td class="num dim">${fmtGold(band.gold)}</td>
    </tr>`;
  }).join('');
  const blocked = plan.blocked ? `<span class="warn">${escapeHtml(plan.blocked)}</span>` : '';
  dom.sum.innerHTML = `
    <span>计划 <b>Lv${plan.startLevel} → Lv${plan.endLevel}</b></span>
    <span>总时长 <b>${fmtDuration(plan.totalHours)}</b></span>
    <span>总花费 <b class="${plan.totalGold > 0 ? 'warn' : 'good'}">${fmtGold(plan.totalGold)}</b></span>
    <span>总经验 <b>${fmtInt(plan.totalXp)}</b></span>
    ${blocked}`;
  dom.levelStart.disabled = !plan.bands.length;
  runner.lastPlan = plan;
}
/* ===== main.js ===== */
/* =========================================================================
 * dvi-profit · main：引导、定时刷新、对外接口
 * ========================================================================= */

const VERSION = '0.1.1';
VERSION_LOCAL = VERSION;

async function boot() {
  if (window.__DVI_PROFIT__) return;
  window.__DVI_PROFIT__ = { version: VERSION, ready: false };
  if (!document.body) { document.addEventListener('DOMContentLoaded', boot, { once: true }); return; }

  ensurePanel();
  await loadPrices(false);
  checkUpdate(false).then(() => uiPainter());
  selectTab(settings.tab === 'level' ? 'level' : 'profit');

  // 每秒刷新状态条；表格内容按需重绘（避免打断输入）
  setInterval(() => {
    uiPainter();
    if (runner.running) return;
  }, 1000);

  // 每 2 秒重绘当前面板（价格/等级会变），输入框聚焦时跳过
  let lastPaint = 0;
  setInterval(() => {
    if (now() - lastPaint < 1500) return;
    const active = shadow?.activeElement;
    if (active && /INPUT|SELECT|TEXTAREA/.test(active.tagName)) return;
    lastPaint = now();
    if (settings.tab === 'level') renderLevel();
    else renderProfit();
  }, 2000);

  // 市场价 5 分钟刷新一次
  setInterval(() => loadPrices(true), PRICE_TTL);

  // 每 6 小时自检一次新版本（油猴自己也会按 @updateURL 检查）
  setInterval(() => checkUpdate(true).then(() => uiPainter()), UPDATE_TTL);

  window.__DVI_PROFIT__ = {
    version: VERSION,
    ready: true,
    prices: () => priceData,
    refreshPrices: () => loadPrices(true),
    list: (options = {}) => profitList(gameState(), options),
    plan: (skill, target, budget) => buildPlan(gameState(), skill, target, budget ?? budgetOf()),
    start: jobId => startProfit(Number(jobId)),
    startLevel: () => startLevel(),
    checkUpdate: force => checkUpdate(force),
    update: () => updateState,
    pause: () => pauseRunner(),
    runner,
    settings,
    jobs: () => JOBS,
    saveSettings
  };

  if (typeof console !== 'undefined') console.log('[dvi-profit] 已加载', VERSION);
}

boot();
})();
