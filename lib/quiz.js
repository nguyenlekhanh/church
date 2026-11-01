/**
 * Christian Prayer Live — Bible quiz.
 *
 * 100+ original questions with verified King James Version references. Answers
 * are short so they can be typed into TikTok comments; `accept` holds alternate
 * spellings and number words. Every explanation is original prose.
 *
 * The engine keeps one question open at a time, reveals the answer after the
 * configured delay, and never repeats a question until the recent window has
 * moved on.
 */

const QUESTIONS = [
  { id: 'q001', question: 'Who built the ark?', answer: 'Noah', accept: ['noah'], reference: 'Genesis 6:14 (KJV)', explanation: 'God told Noah to build an ark of gopher wood to save his household and the animals.' },
  { id: 'q002', question: 'How many days and nights did it rain during the flood?', answer: 'Forty', accept: ['40', 'forty'], reference: 'Genesis 7:12 (KJV)', explanation: 'The rain fell for forty days and forty nights before the waters covered the earth.' },
  { id: 'q003', question: 'What did the dove bring back to Noah?', answer: 'An olive leaf', accept: ['olive leaf', 'olive leaves', 'a leaf', 'leaf'], reference: 'Genesis 8:11 (KJV)', explanation: 'The olive leaf showed Noah that the waters had receded from the earth.' },
  { id: 'q004', question: 'What sign did God set in the cloud after the flood?', answer: 'A rainbow', accept: ['rainbow', 'a rainbow', 'the rainbow'], reference: 'Genesis 9:13 (KJV)', explanation: 'The rainbow is God\u2019s token of the covenant between Him and the earth.' },
  { id: 'q005', question: 'What was the tower called where God confused the languages?', answer: 'Babel', accept: ['babel', 'the tower of babel'], reference: 'Genesis 11:9 (KJV)', explanation: 'The city was called Babel because the Lord confused the language of all the earth.' },
  { id: 'q006', question: 'What garden did God plant for Adam and Eve?', answer: 'Eden', accept: ['eden', 'the garden of eden'], reference: 'Genesis 2:8 (KJV)', explanation: 'God planted a garden eastward in Eden and placed the man there.' },
  { id: 'q007', question: 'What was the first woman called?', answer: 'Eve', accept: ['eve'], reference: 'Genesis 3:20 (KJV)', explanation: 'Adam named his wife Eve because she was the mother of all living.' },
  { id: 'q008', question: 'What did Adam and Eve sew together to cover themselves?', answer: 'Fig leaves', accept: ['fig leaves', 'fig leaf', 'leaves'], reference: 'Genesis 3:7 (KJV)', explanation: 'They sewed fig leaves together and made themselves aprons.' },
  { id: 'q009', question: 'Who killed his brother Abel?', answer: 'Cain', accept: ['cain'], reference: 'Genesis 4:8 (KJV)', explanation: 'Cain rose up against Abel in the field and slew him.' },
  { id: 'q010', question: 'Who walked with God and was not found, because God took him?', answer: 'Enoch', accept: ['enoch'], reference: 'Genesis 5:24 (KJV)', explanation: 'Enoch walked with God, and God took him.' },
  { id: 'q011', question: 'Who was Abram\u2019s nephew who travelled with him?', answer: 'Lot', accept: ['lot'], reference: 'Genesis 12:5 (KJV)', explanation: 'Abram took Sarai his wife and Lot his brother\u2019s son into the land of Canaan.' },
  { id: 'q012', question: 'What name did God give Abram meaning father of many nations?', answer: 'Abraham', accept: ['abraham'], reference: 'Genesis 17:5 (KJV)', explanation: 'God changed his name from Abram to Abraham, a father of many nations.' },
  { id: 'q013', question: 'What was Abraham\u2019s wife called?', answer: 'Sarah', accept: ['sarah', 'sarai'], reference: 'Genesis 17:15 (KJV)', explanation: 'God told Abraham to call his wife Sarah instead of Sarai.' },
  { id: 'q014', question: 'What was the name of Abraham and Sarah\u2019s promised son?', answer: 'Isaac', accept: ['isaac'], reference: 'Genesis 21:3 (KJV)', explanation: 'Abraham called the son that Sarah bore him Isaac, as God had said.' },
  { id: 'q015', question: 'Which twin was born first, red and hairy?', answer: 'Esau', accept: ['esau'], reference: 'Genesis 25:25 (KJV)', explanation: 'The first came out red and hairy, and they called his name Esau.' },
  { id: 'q016', question: 'What did Esau sell to Jacob for bread and pottage?', answer: 'His birthright', accept: ['birthright', 'his birthright', 'the birthright'], reference: 'Genesis 25:33 (KJV)', explanation: 'Esau sold his birthright to Jacob for a meal of bread and pottage.' },
  { id: 'q017', question: 'What did Jacob see in his dream at Bethel?', answer: 'A ladder', accept: ['ladder', 'a ladder', 'stairway'], reference: 'Genesis 28:12 (KJV)', explanation: 'Jacob dreamed of a ladder set up on the earth with angels ascending and descending.' },
  { id: 'q018', question: 'What new name did God give Jacob?', answer: 'Israel', accept: ['israel'], reference: 'Genesis 32:28 (KJV)', explanation: 'God said his name would no longer be Jacob but Israel.' },
  { id: 'q019', question: 'Which brother did the others sell into Egypt?', answer: 'Joseph', accept: ['joseph'], reference: 'Genesis 37:28 (KJV)', explanation: 'Joseph\u2019s brothers sold him to the Ishmaelites for twenty pieces of silver.' },
  { id: 'q020', question: 'Who bought Joseph as a servant in Egypt?', answer: 'Potiphar', accept: ['potiphar'], reference: 'Genesis 39:1 (KJV)', explanation: 'Potiphar, an officer of Pharaoh and captain of the guard, bought Joseph.' },
  { id: 'q021', question: 'Who interpreted Pharaoh\u2019s dreams?', answer: 'Joseph', accept: ['joseph'], reference: 'Genesis 41:16 (KJV)', explanation: 'Joseph said the interpretation belongs to God, then explained the dreams.' },
  { id: 'q022', question: 'What did Moses\u2019 mother make for him?', answer: 'An ark of bulrushes', accept: ['ark of bulrushes', 'an ark of bulrushes', 'ark', 'an ark', 'basket', 'a basket', 'bulrushes'], reference: 'Exodus 2:3 (KJV)', explanation: 'She made an ark of bulrushes and laid the child in it among the flags by the river.' },
  { id: 'q023', question: 'What was burning but not consumed when Moses turned aside?', answer: 'A bush', accept: ['bush', 'a bush', 'burning bush'], reference: 'Exodus 3:2 (KJV)', explanation: 'The bush burned with fire, yet the bush was not consumed.' },
  { id: 'q024', question: 'Who was Moses\u2019 brother?', answer: 'Aaron', accept: ['aaron'], reference: 'Exodus 4:14 (KJV)', explanation: 'God told Moses that Aaron the Levite, his brother, could speak for him.' },
  { id: 'q025', question: 'What did Moses\u2019 rod become before Pharaoh?', answer: 'A serpent', accept: ['serpent', 'a serpent', 'snake', 'a snake'], reference: 'Exodus 7:10 (KJV)', explanation: 'Aaron cast down the rod and it became a serpent before Pharaoh and his servants.' },
  { id: 'q026', question: 'What was the last plague on Egypt?', answer: 'The death of the firstborn', accept: ['death of the firstborn', 'firstborn', 'first born', 'death of firstborn'], reference: 'Exodus 12:29 (KJV)', explanation: 'At midnight the Lord smote all the firstborn in the land of Egypt.' },
  { id: 'q027', question: 'Which sea did Israel cross on dry ground?', answer: 'The Red Sea', accept: ['red sea', 'the red sea'], reference: 'Exodus 14:21 (KJV)', explanation: 'The Lord caused the sea to go back by a strong east wind, and the children of Israel went through.' },
  { id: 'q028', question: 'What food did God rain from heaven for Israel?', answer: 'Manna', accept: ['manna'], reference: 'Exodus 16:15 (KJV)', explanation: 'The people called the bread from heaven manna, meaning \u201cWhat is it?\u201d' },
  { id: 'q029', question: 'What did Moses strike to bring water for the people?', answer: 'A rock', accept: ['rock', 'a rock', 'the rock'], reference: 'Exodus 17:6 (KJV)', explanation: 'God told Moses to smite the rock in Horeb, and water came out for the people to drink.' },
  { id: 'q030', question: 'How many commandments did God give Moses on Sinai?', answer: 'Ten', accept: ['10', 'ten'], reference: 'Exodus 20:1 (KJV)', explanation: 'God spoke all these words, giving Israel the Ten Commandments.' },
  { id: 'q031', question: 'What idol did Israel make while Moses was on the mountain?', answer: 'A golden calf', accept: ['golden calf', 'a golden calf', 'calf'], reference: 'Exodus 32:4 (KJV)', explanation: 'Aaron fashioned a molten calf from gold, and the people worshipped it.' },
  { id: 'q032', question: 'What was the portable place of worship called in the wilderness?', answer: 'The tabernacle', accept: ['tabernacle', 'the tabernacle'], reference: 'Exodus 25:8 (KJV)', explanation: 'God asked Israel to make Him a sanctuary so He could dwell among them.' },
  { id: 'q033', question: 'How many years did Israel wander in the wilderness?', answer: 'Forty', accept: ['40', 'forty'], reference: 'Numbers 14:33 (KJV)', explanation: 'Because of unbelief, the people wandered forty years until that generation passed.' },
  { id: 'q034', question: 'What did Moses lift up on a pole to heal the bitten Israelites?', answer: 'A brass serpent', accept: ['brass serpent', 'serpent', 'snake', 'a serpent'], reference: 'Numbers 21:9 (KJV)', explanation: 'Moses made a serpent of brass; whoever looked at it lived.' },
  { id: 'q035', question: 'Who led Israel after Moses died?', answer: 'Joshua', accept: ['joshua'], reference: 'Deuteronomy 31:7 (KJV)', explanation: 'Moses called Joshua and told him to be strong and of good courage, for he would lead Israel.' },
  { id: 'q036', question: 'Who hid the Israelite spies in Jericho?', answer: 'Rahab', accept: ['rahab'], reference: 'Joshua 2:1 (KJV)', explanation: 'Rahab hid the two spies on her roof and later helped them escape.' },
  { id: 'q037', question: 'Whose walls fell after Israel marched around them?', answer: 'Jericho', accept: ['jericho'], reference: 'Joshua 6:20 (KJV)', explanation: 'The wall of Jericho fell down flat after the people shouted with a great shout.' },
  { id: 'q038', question: 'Who said, \u201cAs for me and my house, we will serve the Lord\u201d?', answer: 'Joshua', accept: ['joshua'], reference: 'Joshua 24:15 (KJV)', explanation: 'Joshua challenged Israel to choose whom they would serve, then declared his own choice.' },
  { id: 'q039', question: 'Who was called to deliver Israel while threshing wheat by the winepress?', answer: 'Gideon', accept: ['gideon'], reference: 'Judges 6:11 (KJV)', explanation: 'The angel of the Lord came to Gideon and called him a mighty man of valor.' },
  { id: 'q040', question: 'How many men did Gideon keep to defeat Midian?', answer: 'Three hundred', accept: ['300', 'three hundred'], reference: 'Judges 7:7 (KJV)', explanation: 'The Lord told Gideon to use only three hundred men so Israel would not boast in themselves.' },
  { id: 'q041', question: 'What was the secret of Samson\u2019s strength?', answer: 'His hair', accept: ['hair', 'his hair', 'his long hair'], reference: 'Judges 16:17 (KJV)', explanation: 'Samson said no razor had come upon his head, and his strength left when his hair was cut.' },
  { id: 'q042', question: 'Who said, \u201cWhither thou goest, I will go\u201d?', answer: 'Ruth', accept: ['ruth'], reference: 'Ruth 1:16 (KJV)', explanation: 'Ruth pledged herself to Naomi and to Naomi\u2019s God rather than return to Moab.' },
  { id: 'q043', question: 'Who was Samuel\u2019s mother?', answer: 'Hannah', accept: ['hannah'], reference: '1 Samuel 1:20 (KJV)', explanation: 'Hannah bore a son and named him Samuel because she had asked him of the Lord.' },
  { id: 'q044', question: 'Who answered, \u201cSpeak; for thy servant heareth\u201d?', answer: 'Samuel', accept: ['samuel'], reference: '1 Samuel 3:10 (KJV)', explanation: 'When the Lord called him, Samuel answered with a willing heart.' },
  { id: 'q045', question: 'Who was the first king of Israel?', answer: 'Saul', accept: ['saul'], reference: '1 Samuel 10:1 (KJV)', explanation: 'Samuel poured oil on Saul\u2019s head and anointed him as captain over God\u2019s inheritance.' },
  { id: 'q046', question: 'Who anointed David to be king?', answer: 'Samuel', accept: ['samuel'], reference: '1 Samuel 16:13 (KJV)', explanation: 'Samuel anointed David in the midst of his brethren, and the Spirit of the Lord came upon him.' },
  { id: 'q047', question: 'What did David use to bring down Goliath?', answer: 'A sling and a stone', accept: ['sling and a stone', 'sling and stone', 'sling', 'stone', 'a stone'], reference: '1 Samuel 17:49 (KJV)', explanation: 'David put his hand in his bag, took a stone, and slung it, striking the giant in his forehead.' },
  { id: 'q048', question: 'Who was David\u2019s closest friend and Saul\u2019s son?', answer: 'Jonathan', accept: ['jonathan'], reference: '1 Samuel 18:1 (KJV)', explanation: 'The soul of Jonathan was knit with the soul of David, and Jonathan loved him as his own soul.' },
  { id: 'q049', question: 'Which prophet confronted David about Bathsheba?', answer: 'Nathan', accept: ['nathan'], reference: '2 Samuel 12:13 (KJV)', explanation: 'Nathan told David a parable, and David confessed his sin before the Lord.' },
  { id: 'q050', question: 'What did Solomon ask God to give him?', answer: 'Wisdom', accept: ['wisdom', 'an understanding heart'], reference: '1 Kings 3:9 (KJV)', explanation: 'Solomon asked for an understanding heart to judge God\u2019s people.' },
  { id: 'q051', question: 'Who built the first temple in Jerusalem?', answer: 'Solomon', accept: ['solomon'], reference: '1 Kings 6:1 (KJV)', explanation: 'Solomon began to build the house of the Lord in the fourth year of his reign.' },
  { id: 'q052', question: 'Which queen came to test Solomon with hard questions?', answer: 'The Queen of Sheba', accept: ['queen of sheba', 'sheba'], reference: '1 Kings 10:1 (KJV)', explanation: 'The queen of Sheba came to prove Solomon with hard questions and was amazed at his wisdom.' },
  { id: 'q053', question: 'What birds fed Elijah by the brook Cherith?', answer: 'Ravens', accept: ['ravens', 'raven', 'birds'], reference: '1 Kings 17:6 (KJV)', explanation: 'The ravens brought Elijah bread and flesh in the morning and in the evening.' },
  { id: 'q054', question: 'On which mountain did Elijah call down fire from heaven?', answer: 'Carmel', accept: ['carmel', 'mount carmel'], reference: '1 Kings 18:19 (KJV)', explanation: 'Elijah gathered Israel at Mount Carmel, and the fire of the Lord fell and consumed the offering.' },
  { id: 'q055', question: 'How was Elijah taken from Elisha?', answer: 'In a whirlwind', accept: ['in a whirlwind', 'whirlwind', 'a whirlwind', 'chariot of fire', 'chariot'], reference: '2 Kings 2:11 (KJV)', explanation: 'A chariot of fire appeared, and Elijah went up by a whirlwind into heaven.' },
  { id: 'q056', question: 'Who was healed of leprosy after washing in the Jordan seven times?', answer: 'Naaman', accept: ['naaman'], reference: '2 Kings 5:14 (KJV)', explanation: 'Naaman dipped himself seven times in Jordan, and his flesh came again like a little child\u2019s.' },
  { id: 'q057', question: 'Which king allowed the Jews to return from Babylon?', answer: 'Cyrus', accept: ['cyrus', 'king cyrus'], reference: 'Ezra 1:1 (KJV)', explanation: 'The Lord stirred up the spirit of Cyrus king of Persia to make a proclamation to rebuild the temple.' },
  { id: 'q058', question: 'Who rebuilt the walls of Jerusalem after the exile?', answer: 'Nehemiah', accept: ['nehemiah'], reference: 'Nehemiah 2:5 (KJV)', explanation: 'Nehemiah asked the king to send him so he could rebuild the city of his fathers\u2019 sepulchres.' },
  { id: 'q059', question: 'Who raised Esther after her parents died?', answer: 'Mordecai', accept: ['mordecai'], reference: 'Esther 2:7 (KJV)', explanation: 'Mordecai took Esther as his own daughter when her father and mother died.' },
  { id: 'q060', question: 'Which book tells of the woman who said, \u201cIf I perish, I perish\u201d?', answer: 'Esther', accept: ['esther'], reference: 'Esther 4:16 (KJV)', explanation: 'Esther resolved to go before the king, trusting God with the outcome.' },
  { id: 'q061', question: 'Which book records the suffering of a righteous man who lost everything?', answer: 'Job', accept: ['job'], reference: 'Job 2:7 (KJV)', explanation: 'Job was struck with sore boils yet still held fast his integrity.' },
  { id: 'q062', question: 'Which book begins, \u201cThe Lord is my shepherd\u201d?', answer: 'Psalms', accept: ['psalms', 'psalm'], reference: 'Psalm 23:1 (KJV)', explanation: 'Psalm 23 pictures the Lord as a shepherd who provides and guides.' },
  { id: 'q063', question: 'Which is the longest chapter in the Bible?', answer: 'Psalm 119', accept: ['psalm 119', '119', 'psalms 119'], reference: 'Psalm 119:1 (KJV)', explanation: 'Psalm 119 is the longest chapter, celebrating the word of God.' },
  { id: 'q064', question: 'How many psalms are in the book of Psalms?', answer: 'One hundred and fifty', accept: ['150', 'one hundred fifty', 'one hundred and fifty'], reference: 'Psalm 150:6 (KJV)', explanation: 'The book of Psalms closes with the 150th psalm of praise.' },
  { id: 'q065', question: 'Which book says, \u201cTrust in the Lord with all thine heart\u201d?', answer: 'Proverbs', accept: ['proverbs'], reference: 'Proverbs 3:5 (KJV)', explanation: 'Proverbs calls us to trust God rather than lean on our own understanding.' },
  { id: 'q066', question: 'Which book says, \u201cVanity of vanities, all is vanity\u201d?', answer: 'Ecclesiastes', accept: ['ecclesiastes'], reference: 'Ecclesiastes 1:2 (KJV)', explanation: 'Ecclesiastes reflects on the limits of earthly pursuits without God.' },
  { id: 'q067', question: 'Which prophet saw the Lord high and lifted up in the temple?', answer: 'Isaiah', accept: ['isaiah'], reference: 'Isaiah 6:1 (KJV)', explanation: 'Isaiah saw the Lord sitting upon a throne, high and lifted up.' },
  { id: 'q068', question: 'Which prophet foretold that a virgin would bear a son?', answer: 'Isaiah', accept: ['isaiah'], reference: 'Isaiah 7:14 (KJV)', explanation: 'Isaiah prophesied the sign of Immanuel, fulfilled in the birth of Jesus.' },
  { id: 'q069', question: 'They that wait upon the Lord shall mount up with wings as what?', answer: 'Eagles', accept: ['eagles', 'an eagle', 'eagle'], reference: 'Isaiah 40:31 (KJV)', explanation: 'Those who wait on the Lord renew their strength and rise with wings as eagles.' },
  { id: 'q070', question: 'Which book says, \u201cBefore I formed thee in the belly I knew thee\u201d?', answer: 'Jeremiah', accept: ['jeremiah'], reference: 'Jeremiah 1:5 (KJV)', explanation: 'God called Jeremiah before he was born and set him over nations and kingdoms.' },
  { id: 'q071', question: 'Which book speaks of God\u2019s thoughts of peace and an expected end?', answer: 'Jeremiah', accept: ['jeremiah'], reference: 'Jeremiah 29:11 (KJV)', explanation: 'God spoke through Jeremiah to a people in exile, offering hope and a future.' },
  { id: 'q072', question: 'Which book says God\u2019s mercies are new every morning?', answer: 'Lamentations', accept: ['lamentations'], reference: 'Lamentations 3:23 (KJV)', explanation: 'Even in grief, the writer remembers that God\u2019s compassions fail not.' },
  { id: 'q073', question: 'Which prophet saw a valley of dry bones come alive?', answer: 'Ezekiel', accept: ['ezekiel'], reference: 'Ezekiel 37:1 (KJV)', explanation: 'Ezekiel saw dry bones rise into a great army, a picture of restoration.' },
  { id: 'q074', question: 'Which king set up a golden image in Babylon?', answer: 'Nebuchadnezzar', accept: ['nebuchadnezzar'], reference: 'Daniel 3:1 (KJV)', explanation: 'Nebuchadnezzar made an image of gold and commanded all to bow before it.' },
  { id: 'q075', question: 'Which king saw the writing on the wall?', answer: 'Belshazzar', accept: ['belshazzar'], reference: 'Daniel 5:1 (KJV)', explanation: 'Belshazzar made a feast and saw fingers write on the palace wall.' },
  { id: 'q076', question: 'Who was thrown into the lions\u2019 den?', answer: 'Daniel', accept: ['daniel'], reference: 'Daniel 6:16 (KJV)', explanation: 'Daniel was cast into the den of lions for praying to God, and God shut the lions\u2019 mouths.' },
  { id: 'q077', question: 'Which prophet was told to marry Gomer?', answer: 'Hosea', accept: ['hosea'], reference: 'Hosea 1:2 (KJV)', explanation: 'Hosea\u2019s marriage became a living picture of God\u2019s faithful love.' },
  { id: 'q078', question: 'Which prophet was a herdsman and gatherer of sycamore fruit?', answer: 'Amos', accept: ['amos'], reference: 'Amos 7:14 (KJV)', explanation: 'Amos answered that he was no prophet by trade but a herdsman called by God.' },
  { id: 'q079', question: 'What swallowed Jonah after he fled?', answer: 'A great fish', accept: ['great fish', 'a great fish', 'fish', 'whale', 'a whale'], reference: 'Jonah 1:17 (KJV)', explanation: 'The Lord prepared a great fish to swallow Jonah, and he was in it three days and three nights.' },
  { id: 'q080', question: 'Which city did God send Jonah to warn?', answer: 'Nineveh', accept: ['nineveh'], reference: 'Jonah 3:2 (KJV)', explanation: 'Jonah was sent to Nineveh, and the city repented at his preaching.' },
  { id: 'q081', question: 'Which prophet named Bethlehem as the birthplace of the coming ruler?', answer: 'Micah', accept: ['micah'], reference: 'Micah 5:2 (KJV)', explanation: 'Micah foretold that out of Bethlehem would come one whose goings forth are from everlasting.' },
  { id: 'q082', question: 'Which prophet spoke of the king coming riding on an ass?', answer: 'Zechariah', accept: ['zechariah', 'zachariah'], reference: 'Zechariah 9:9 (KJV)', explanation: 'Zechariah foretold a humble king riding upon a colt, fulfilled on Palm Sunday.' },
  { id: 'q083', question: 'Which book asks, \u201cWill a man rob God?\u201d about tithes?', answer: 'Malachi', accept: ['malachi'], reference: 'Malachi 3:8 (KJV)', explanation: 'Malachi challenged Israel to bring the tithes into the storehouse and trust God\u2019s blessing.' },
  { id: 'q084', question: 'Who was Jesus\u2019 earthly father?', answer: 'Joseph', accept: ['joseph'], reference: 'Matthew 1:20 (KJV)', explanation: 'The angel told Joseph to take Mary as his wife, for the child was of the Holy Ghost.' },
  { id: 'q085', question: 'In what town was Jesus born?', answer: 'Bethlehem', accept: ['bethlehem'], reference: 'Matthew 2:1 (KJV)', explanation: 'Jesus was born in Bethlehem of Judaea in the days of Herod the king.' },
  { id: 'q086', question: 'In what river was Jesus baptized?', answer: 'The Jordan', accept: ['jordan', 'the jordan', 'river jordan'], reference: 'Matthew 3:13 (KJV)', explanation: 'Jesus came from Galilee to the Jordan to be baptized by John.' },
  { id: 'q087', question: 'Where did the Spirit lead Jesus to be tempted?', answer: 'The wilderness', accept: ['wilderness', 'the wilderness', 'desert'], reference: 'Matthew 4:1 (KJV)', explanation: 'Jesus was led into the wilderness to be tempted by the devil.' },
  { id: 'q088', question: 'Which disciple was sitting at the receipt of custom when Jesus called him?', answer: 'Matthew', accept: ['matthew'], reference: 'Matthew 9:9 (KJV)', explanation: 'Jesus said to Matthew, \u201cFollow me,\u201d and he arose and followed Him.' },
  { id: 'q089', question: 'How many loaves did the disciples have when Jesus fed five thousand?', answer: 'Five', accept: ['5', 'five'], reference: 'Matthew 14:17 (KJV)', explanation: 'They had five loaves and two fishes, and all were filled.' },
  { id: 'q090', question: 'Which disciple walked on the water toward Jesus?', answer: 'Peter', accept: ['peter', 'simon peter'], reference: 'Matthew 14:29 (KJV)', explanation: 'Peter walked on the water, and when he began to sink, Jesus caught him.' },
  { id: 'q091', question: 'What animal did Jesus ride into Jerusalem?', answer: 'A donkey', accept: ['donkey', 'a donkey', 'ass', 'colt', 'an ass'], reference: 'Matthew 21:5 (KJV)', explanation: 'Jesus rode into Jerusalem on an ass and a colt, fulfilling the prophet.' },
  { id: 'q092', question: 'In what garden did Jesus pray before His arrest?', answer: 'Gethsemane', accept: ['gethsemane'], reference: 'Matthew 26:36 (KJV)', explanation: 'Jesus went with His disciples to a place called Gethsemane and prayed there.' },
  { id: 'q093', question: 'What did the soldiers put on Jesus\u2019 head?', answer: 'A crown of thorns', accept: ['crown of thorns', 'thorns', 'a crown'], reference: 'Matthew 27:29 (KJV)', explanation: 'They plaited a crown of thorns and put it upon His head, mocking Him as king.' },
  { id: 'q094', question: 'Who was compelled to carry Jesus\u2019 cross?', answer: 'Simon of Cyrene', accept: ['simon of cyrene', 'simon', 'cyrene'], reference: 'Matthew 27:32 (KJV)', explanation: 'The soldiers compelled Simon, a man of Cyrene, to bear the cross.' },
  { id: 'q095', question: 'What did Jesus calm with the words \u201cPeace, be still\u201d?', answer: 'The storm', accept: ['storm', 'the storm', 'sea', 'wind', 'tempest'], reference: 'Mark 4:39 (KJV)', explanation: 'Jesus rebuked the wind and said to the sea, \u201cPeace, be still,\u201d and there was a great calm.' },
  { id: 'q096', question: 'Who was healed of blindness near Jericho?', answer: 'Bartimaeus', accept: ['bartimaeus', 'blind bartimaeus'], reference: 'Mark 10:46 (KJV)', explanation: 'Blind Bartimaeus cried out to Jesus and received his sight.' },
  { id: 'q097', question: 'Where did Mary lay the newborn Jesus?', answer: 'A manger', accept: ['manger', 'a manger', 'in a manger'], reference: 'Luke 2:7 (KJV)', explanation: 'Mary laid Jesus in a manger because there was no room in the inn.' },
  { id: 'q098', question: 'Who were keeping watch over their flocks when Jesus was born?', answer: 'Shepherds', accept: ['shepherds', 'shepherd', 'the shepherds'], reference: 'Luke 2:8 (KJV)', explanation: 'The angel announced the birth to shepherds abiding in the field by night.' },
  { id: 'q099', question: 'How many apostles did Jesus choose?', answer: 'Twelve', accept: ['12', 'twelve'], reference: 'Luke 6:13 (KJV)', explanation: 'Jesus called His disciples and chose twelve of them, whom He named apostles.' },
  { id: 'q100', question: 'Which sister welcomed Jesus into her home in Bethany?', answer: 'Martha', accept: ['martha'], reference: 'Luke 10:38 (KJV)', explanation: 'Martha received Jesus into her house, while Mary sat at His feet.' },
  { id: 'q101', question: 'How many sheep did the shepherd leave to search for one lost sheep?', answer: 'Ninety-nine', accept: ['99', 'ninety nine', 'ninety-nine'], reference: 'Luke 15:4 (KJV)', explanation: 'The shepherd left the ninety and nine to find the one that was lost.' },
  { id: 'q102', question: 'How many lepers returned to thank Jesus?', answer: 'One', accept: ['1', 'one'], reference: 'Luke 17:15 (KJV)', explanation: 'Only one of the ten healed lepers turned back to give thanks.' },
  { id: 'q103', question: 'Who climbed a sycamore tree to see Jesus?', answer: 'Zacchaeus', accept: ['zacchaeus'], reference: 'Luke 19:4 (KJV)', explanation: 'Zacchaeus ran ahead and climbed a sycamore tree because he was small of stature.' },
  { id: 'q104', question: 'What was the place of Jesus\u2019 crucifixion called?', answer: 'Calvary', accept: ['calvary', 'golgotha'], reference: 'Luke 23:33 (KJV)', explanation: 'They brought Jesus to the place called Calvary, where they crucified Him.' },
  { id: 'q105', question: 'Which Gospel begins, \u201cIn the beginning was the Word\u201d?', answer: 'John', accept: ['john'], reference: 'John 1:1 (KJV)', explanation: 'John opens by declaring the Word was with God and was God.' },
  { id: 'q106', question: 'What did Jesus turn the water into at Cana?', answer: 'Wine', accept: ['wine'], reference: 'John 2:9 (KJV)', explanation: 'Jesus turned water into wine at the wedding feast, the first of His miracles.' },
  { id: 'q107', question: 'How many fishes were there with the five barley loaves?', answer: 'Two', accept: ['2', 'two'], reference: 'John 6:9 (KJV)', explanation: 'A lad had five barley loaves and two small fishes, and Jesus fed the multitude.' },
  { id: 'q108', question: 'Jesus said, \u201cI am the good \u2026\u201d what?', answer: 'Shepherd', accept: ['shepherd', 'the good shepherd'], reference: 'John 10:11 (KJV)', explanation: 'Jesus called Himself the good shepherd who gives His life for the sheep.' },
  { id: 'q109', question: 'Who came out of the grave when Jesus called after four days?', answer: 'Lazarus', accept: ['lazarus'], reference: 'John 11:39 (KJV)', explanation: 'Lazarus had been dead four days, and Jesus called him forth from the tomb.' },
  { id: 'q110', question: 'Which disciple cut off the servant\u2019s ear in the garden?', answer: 'Peter', accept: ['peter', 'simon peter'], reference: 'John 18:10 (KJV)', explanation: 'Peter drew his sword and cut off the ear of Malchus, the high priest\u2019s servant.' },
  { id: 'q111', question: 'Who asked Jesus, \u201cWhat is truth?\u201d', answer: 'Pilate', accept: ['pilate', 'pontius pilate'], reference: 'John 18:38 (KJV)', explanation: 'Pilate asked the question but did not wait for the answer.' },
  { id: 'q112', question: 'Who helped Joseph of Arimathea prepare Jesus\u2019 body for burial?', answer: 'Nicodemus', accept: ['nicodemus'], reference: 'John 19:39 (KJV)', explanation: 'Nicodemus brought a mixture of myrrh and aloes for the burial.' },
  { id: 'q113', question: 'Which disciple refused to believe until he saw the wounds?', answer: 'Thomas', accept: ['thomas', 'doubting thomas'], reference: 'John 20:25 (KJV)', explanation: 'Thomas said he would not believe unless he saw the print of the nails.' },
  { id: 'q114', question: 'How many great fish filled the disciples\u2019 net after the resurrection?', answer: 'One hundred and fifty-three', accept: ['153', 'one hundred fifty three', 'one hundred and fifty-three'], reference: 'John 21:11 (KJV)', explanation: 'The net was full of great fishes, an hundred and fifty and three.' },
  { id: 'q115', question: 'For how many days did Jesus appear after His resurrection?', answer: 'Forty', accept: ['40', 'forty'], reference: 'Acts 1:3 (KJV)', explanation: 'Jesus showed Himself alive by many infallible proofs for forty days.' },
  { id: 'q116', question: 'On what day did the Holy Spirit fill the disciples?', answer: 'Pentecost', accept: ['pentecost', 'the day of pentecost'], reference: 'Acts 2:1 (KJV)', explanation: 'On the day of Pentecost they were all filled with the Holy Ghost.' },
  { id: 'q117', question: 'Who was the first Christian martyr?', answer: 'Stephen', accept: ['stephen'], reference: 'Acts 7:59 (KJV)', explanation: 'Stephen was stoned while calling on God and forgiving his attackers.' },
  { id: 'q118', question: 'Who did Philip baptize on the desert road to Gaza?', answer: 'An Ethiopian', accept: ['ethiopian', 'the ethiopian', 'eunuch', 'an ethiopian'], reference: 'Acts 8:38 (KJV)', explanation: 'Philip baptized the Ethiopian eunuch after explaining Isaiah to him.' },
  { id: 'q119', question: 'Who was blinded by a light on the road to Damascus?', answer: 'Saul', accept: ['saul', 'paul', 'saul of tarsus'], reference: 'Acts 9:8 (KJV)', explanation: 'Saul rose from the ground blind and was led by the hand into Damascus.' },
  { id: 'q120', question: 'Who was the Roman centurion baptized by Peter?', answer: 'Cornelius', accept: ['cornelius'], reference: 'Acts 10:48 (KJV)', explanation: 'Peter commanded Cornelius and his household to be baptized in the name of the Lord.' },
  { id: 'q121', question: 'Who sang hymns with Paul in the Philippian prison?', answer: 'Silas', accept: ['silas'], reference: 'Acts 16:25 (KJV)', explanation: 'About midnight Paul and Silas prayed and sang praises to God.' },
  { id: 'q122', question: 'On which island was Paul shipwrecked?', answer: 'Malta', accept: ['malta'], reference: 'Acts 28:1 (KJV)', explanation: 'They learned that the island was called Melita, known today as Malta.' },
  { id: 'q123', question: 'Which book says, \u201cFor all have sinned, and come short of the glory of God\u201d?', answer: 'Romans', accept: ['romans'], reference: 'Romans 3:23 (KJV)', explanation: 'Romans teaches that every person needs the grace of God.' },
  { id: 'q124', question: 'What is the wages of sin?', answer: 'Death', accept: ['death', 'the wages of sin is death'], reference: 'Romans 6:23 (KJV)', explanation: 'Sin earns death, but the gift of God is eternal life through Jesus Christ.' },
  { id: 'q125', question: 'What must be renewed for us to prove the good will of God?', answer: 'The mind', accept: ['mind', 'the mind', 'your mind', 'our mind'], reference: 'Romans 12:2 (KJV)', explanation: 'Paul calls believers to be transformed by the renewing of the mind.' },
  { id: 'q126', question: 'Which chapter is known as the love chapter?', answer: '1 Corinthians 13', accept: ['1 corinthians 13', 'first corinthians 13', 'corinthians 13', '13'], reference: '1 Corinthians 13:1 (KJV)', explanation: '1 Corinthians 13 describes love as the greatest enduring gift.' },
  { id: 'q127', question: 'On which day did Christ rise according to 1 Corinthians 15?', answer: 'The third day', accept: ['third day', 'the third day', '3rd day', 'three'], reference: '1 Corinthians 15:4 (KJV)', explanation: 'Paul declares that Christ died for our sins and rose again the third day.' },
  { id: 'q128', question: 'In Christ, what does a believer become?', answer: 'A new creature', accept: ['new creature', 'a new creature', 'new creation', 'a new creation'], reference: '2 Corinthians 5:17 (KJV)', explanation: 'If any man be in Christ, he is a new creature; old things are passed away.' },
  { id: 'q129', question: 'Which book lists the fruit of the Spirit?', answer: 'Galatians', accept: ['galatians'], reference: 'Galatians 5:22 (KJV)', explanation: 'Galatians names love, joy, peace and the other fruit of the Spirit.' },
  { id: 'q130', question: 'By what are we saved, according to Ephesians 2?', answer: 'Grace', accept: ['grace', 'by grace'], reference: 'Ephesians 2:8 (KJV)', explanation: 'We are saved by grace through faith, and that not of ourselves.' },
  { id: 'q131', question: 'What does Ephesians tell believers to put on?', answer: 'The whole armour of God', accept: ['whole armour of god', 'the whole armour of god', 'armour of god', 'armor of god', 'the armour', 'armour', 'armor'], reference: 'Ephesians 6:11 (KJV)', explanation: 'Believers are told to put on the whole armour of God to stand against the wiles of the devil.' },
  { id: 'q132', question: 'Which book says, \u201cI can do all things through Christ\u201d?', answer: 'Philippians', accept: ['philippians'], reference: 'Philippians 4:13 (KJV)', explanation: 'Paul wrote this from prison, learning contentment in every circumstance.' },
  { id: 'q133', question: 'Which book tells believers to forgive one another?', answer: 'Colossians', accept: ['colossians'], reference: 'Colossians 3:13 (KJV)', explanation: 'Paul calls the church to forgive as the Lord forgave them.' },
  { id: 'q134', question: 'Which letter speaks of the Lord descending with a shout?', answer: '1 Thessalonians', accept: ['1 thessalonians', 'first thessalonians', 'thessalonians'], reference: '1 Thessalonians 4:16 (KJV)', explanation: 'Paul describes the Lord descending with a shout and the dead in Christ rising first.' },
  { id: 'q135', question: 'Who was Timothy\u2019s grandmother?', answer: 'Lois', accept: ['lois'], reference: '2 Timothy 1:5 (KJV)', explanation: 'Paul remembered the unfeigned faith that dwelt first in Lois and then in Timothy.' },
  { id: 'q136', question: 'Which book has the great chapter on faith?', answer: 'Hebrews', accept: ['hebrews'], reference: 'Hebrews 11:1 (KJV)', explanation: 'Hebrews 11 defines faith and recounts the faithful of old.' },
  { id: 'q137', question: 'What should believers be, and not hearers only?', answer: 'Doers of the word', accept: ['doers', 'doers of the word', 'doers of the word only'], reference: 'James 1:22 (KJV)', explanation: 'James calls believers to act on the word they hear.' },
  { id: 'q138', question: 'Which book says, \u201cCasting all your care upon him\u201d?', answer: '1 Peter', accept: ['1 peter', 'first peter', 'peter'], reference: '1 Peter 5:7 (KJV)', explanation: 'Peter reminds believers that God cares for them.' },
  { id: 'q139', question: 'Which book says, \u201cIf we confess our sins, he is faithful\u201d?', answer: '1 John', accept: ['1 john', 'first john', 'john'], reference: '1 John 1:9 (KJV)', explanation: 'God forgives and cleanses those who confess their sins.' },
  { id: 'q140', question: 'How many churches are addressed in Revelation?', answer: 'Seven', accept: ['7', 'seven'], reference: 'Revelation 1:11 (KJV)', explanation: 'John was told to write to the seven churches in Asia.' },
  { id: 'q141', question: 'From which tribe comes the Lion of Judah?', answer: 'Judah', accept: ['judah'], reference: 'Revelation 5:5 (KJV)', explanation: 'The Lion of the tribe of Judah has prevailed to open the book.' },
  { id: 'q142', question: 'What is the name of the holy city coming down from God?', answer: 'New Jerusalem', accept: ['new jerusalem', 'jerusalem'], reference: 'Revelation 21:2 (KJV)', explanation: 'John saw the holy city, new Jerusalem, coming down from God out of heaven.' },
  { id: 'q143', question: 'How many books are in the Bible?', answer: 'Sixty-six', accept: ['66', 'sixty six', 'sixty-six'], reference: '2 Timothy 3:16 (KJV)', explanation: 'The Bible contains sixty-six books, all given by inspiration of God.' },
  { id: 'q144', question: 'What is the shortest verse in the King James Bible?', answer: 'Jesus wept', accept: ['jesus wept', 'john 11 35'], reference: 'John 11:35 (KJV)', explanation: 'At Lazarus\u2019 tomb, Jesus wept, showing His compassion.' },
  { id: 'q145', question: 'Which book says, \u201cThe Lord is my light and my salvation\u201d?', answer: 'Psalms', accept: ['psalms', 'psalm'], reference: 'Psalm 27:1 (KJV)', explanation: 'David declares confidence in God even when enemies rise.' },
  { id: 'q146', question: 'What did God give Moses on Mount Sinai?', answer: 'The Ten Commandments', accept: ['ten commandments', 'the ten commandments', 'commandments', 'tables of stone'], reference: 'Exodus 20:1 (KJV)', explanation: 'God gave Moses the commandments written for Israel\u2019s life together.' },
  { id: 'q147', question: 'Who was the mother of Isaac?', answer: 'Sarah', accept: ['sarah'], reference: 'Genesis 21:2 (KJV)', explanation: 'Sarah conceived and bore Abraham a son in his old age.' },
  { id: 'q148', question: 'Which prophet was taken to heaven without dying?', answer: 'Enoch', accept: ['enoch'], reference: 'Genesis 5:24 (KJV)', explanation: 'Enoch walked with God, and he was not, for God took him.' },
  { id: 'q149', question: 'What did Jesus say He was in John 14:6 besides the truth and the life?', answer: 'The way', accept: ['way', 'the way'], reference: 'John 14:6 (KJV)', explanation: 'Jesus said, \u201cI am the way, the truth, and the life.\u201d' },
  { id: 'q150', question: 'Which book ends with the promise that God will wipe away all tears?', answer: 'Revelation', accept: ['revelation', 'revelations'], reference: 'Revelation 21:4 (KJV)', explanation: 'Revelation closes the Bible with the hope of a renewed creation where sorrow ends.' }
];

const DISPLAY_DEFAULTS = {
  enabled: true,
  frequencyMinutes: 10,
  revealSeconds: 25,
  tts: true
};

const RECENT_LIMIT = 50;

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(the|a|an)\s+/, '');
}

function questionById(id) {
  return QUESTIONS.find((question) => question.id === id) || null;
}

/** Short, human-readable question payload (answer omitted until reveal). */
function publicQuestion(question) {
  return {
    id: question.id,
    question: question.question,
    answerLength: question.answer.length
  };
}

class QuizEngine {
  constructor(options = {}) {
    this.getSettings = options.getSettings || (() => DISPLAY_DEFAULTS);
    this.publish = options.publish || (() => {});
    this.onChange = options.onChange || (() => {});
    this.initialRecent = Array.isArray(options.recent) ? options.recent.slice(0, RECENT_LIMIT) : [];

    this.active = null;
    this.recent = this.initialRecent;
    this.totalCorrect = 0;
    this.asked = 0;
    this.nextTimer = null;
    this.revealTimer = null;
    this.endTimer = null;
  }

  get settings() {
    return { ...DISPLAY_DEFAULTS, ...(this.getSettings() || {}) };
  }

  clearTimers() {
    clearTimeout(this.nextTimer);
    clearTimeout(this.revealTimer);
    clearTimeout(this.endTimer);
    this.nextTimer = null;
    this.revealTimer = null;
    this.endTimer = null;
  }

  status() {
    const active = this.active;
    return {
      enabled: this.settings.enabled,
      frequencyMinutes: this.settings.frequencyMinutes,
      revealSeconds: this.settings.revealSeconds,
      tts: this.settings.tts,
      totalQuestions: QUESTIONS.length,
      asked: this.asked,
      totalCorrect: this.totalCorrect,
      recentCount: this.recent.length,
      active: active
        ? {
            id: active.question.id,
            question: active.question.question,
            revealed: active.revealed,
            startedAt: new Date(active.startedAt).toISOString(),
            revealAt: new Date(active.revealAt).toISOString(),
            secondsLeft: Math.max(0, Math.ceil((active.revealAt - Date.now()) / 1000)),
            correctCount: active.correct.length,
            correctNames: active.correct.map((entry) => entry.name).slice(0, 4),
            answer: active.revealed ? active.question.answer : null,
            reference: active.revealed ? active.question.reference : null,
            explanation: active.revealed ? active.question.explanation : null
          }
        : null
    };
  }

  /** Applies settings after the server has mutated them. */
  sync({ firstRun = false } = {}) {
    const settings = this.settings;
    if (!settings.enabled) {
      this.stop();
      this.onChange();
      return this.status();
    }
    if (!this.active) {
      if (!this.nextTimer) {
        const delay = firstRun ? 45000 : Math.max(10, settings.frequencyMinutes * 60) * 1000;
        this.scheduleNext(delay);
      }
    } else if (!this.active.revealed) {
      const revealAt = this.active.startedAt + settings.revealSeconds * 1000;
      if (revealAt <= Date.now()) this.reveal();
      else {
        clearTimeout(this.revealTimer);
        this.active.revealAt = revealAt;
        this.revealTimer = setTimeout(() => this.reveal(), Math.max(500, revealAt - Date.now()));
      }
    }
    this.onChange();
    return this.status();
  }

  stop() {
    this.clearTimers();
    this.active = null;
  }

  scheduleNext(delayMs) {
    this.clearTimers();
    if (!this.settings.enabled) return;
    const delay = Math.max(5000, Number(delayMs) || 600000);
    this.nextTimer = setTimeout(() => {
      this.nextTimer = null;
      this.startQuestion({ source: 'auto' });
    }, delay);
  }

  pickQuestion() {
    const pool = QUESTIONS.filter((question) => !this.recent.includes(question.id));
    const source = pool.length > 0 ? pool : QUESTIONS;
    const question = source[Math.floor(Math.random() * source.length)];
    this.recent = [question.id, ...this.recent.filter((id) => id !== question.id)].slice(0, RECENT_LIMIT);
    return question;
  }

  startQuestion({ source = 'auto' } = {}) {
    if (!this.settings.enabled) return null;
    this.clearTimers();
    const question = this.pickQuestion();
    const settings = this.settings;
    const now = Date.now();
    this.active = {
      question,
      startedAt: now,
      revealAt: now + settings.revealSeconds * 1000,
      revealed: false,
      correct: []
    };
    this.asked += 1;
    this.publish('start', {
      id: question.id,
      question: question.question,
      revealAt: new Date(this.active.revealAt).toISOString(),
      revealSeconds: settings.revealSeconds,
      source,
      totalQuestions: QUESTIONS.length
    });
    this.revealTimer = setTimeout(() => this.reveal(), settings.revealSeconds * 1000);
    this.onChange();
    return this.status();
  }

  reveal() {
    if (!this.active || this.active.revealed) return null;
    clearTimeout(this.revealTimer);
    this.revealTimer = null;
    this.active.revealed = true;
    const question = this.active.question;
    const correctCount = this.active.correct.length;
    this.publish('reveal', {
      id: question.id,
      question: question.question,
      answer: question.answer,
      reference: question.reference,
      explanation: question.explanation,
      correctCount,
      correctNames: this.active.correct.map((entry) => entry.name).slice(0, 4)
    });
    this.endTimer = setTimeout(() => this.end(), 14000);
    this.onChange();
    return this.status();
  }

  end() {
    if (!this.active) return;
    const { id } = this.active.question;
    const correctCount = this.active.correct.length;
    this.publish('end', { id, correctCount });
    this.active = null;
    this.onChange();
    this.scheduleNext(Math.max(10, this.settings.frequencyMinutes * 60) * 1000);
  }

  next({ source = 'manual' } = {}) {
    return this.startQuestion({ source });
  }

  /** Returns { correct, already } when the text matches the open answer. */
  submitAnswer({ text, name, uniqueId }) {
    if (!this.active || this.active.revealed) return null;
    const question = this.active.question;
    const normalized = normalize(text);
    if (!normalized) return null;

    const accepted = [question.answer, ...(question.accept || [])].map(normalize);
    let matched = accepted.includes(normalized);
    if (!matched && normalized.length <= 60) {
      matched = accepted.some((candidate) => (
        candidate.length >= 4
        && (` ${normalized} `).includes(` ${candidate} `)
      ));
    }
    if (!matched) return null;

    const key = String(uniqueId || name || '').toLowerCase();
    if (this.active.correct.some((entry) => entry.key === key)) {
      return { correct: true, already: true, question };
    }
    this.active.correct.push({ key, name, at: Date.now() });
    this.totalCorrect += 1;
    this.publish('correct', {
      id: question.id,
      name,
      correctCount: this.active.correct.length,
      totalCorrect: this.totalCorrect
    });
    this.onChange();
    return { correct: true, already: false, question };
  }
}

module.exports = {
  QUESTIONS,
  QuizEngine,
  normalize,
  questionById,
  publicQuestion,
  DISPLAY_DEFAULTS,
  RECENT_LIMIT
};
