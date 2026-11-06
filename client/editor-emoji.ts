// 2026-11-04: a local, searchable vocabulary; Unicode stays readable in project Markdown.
const vocabulary = `😀|grinning|улыбка smile happy
😃|smiley|радость smile happy
😄|smile|счастье happy
😁|grin|улыбка happy
😆|laughing|смех laugh
😅|sweat_smile|пот relieved
😂|joy|смех слезы laugh
🤣|rofl|смех laugh
🙂|slightly_smiling_face|улыбка smile
🙃|upside_down_face|ирония smile
😉|wink|подмигивание
😊|blush|смущение happy
😇|innocent|ангел
🥰|smiling_face_with_hearts|любовь love
😍|heart_eyes|любовь love
🤩|star_struck|восторг star
😘|kissing_heart|поцелуй love
😋|yum|вкусно food
😛|stuck_out_tongue|язык
🤔|thinking|мысль вопрос think
🤨|raised_eyebrow|сомнение
🧐|monocle_face|исследование review
🤓|nerd_face|ученый code
😎|sunglasses|круто cool
🥳|partying_face|праздник party
😐|neutral_face|нейтрально
😑|expressionless|безразличие
😶|no_mouth|молчание
🙄|roll_eyes|закатить глаза
😏|smirk|усмешка
😔|pensive|грусть sad
😴|sleeping|сон sleep
🤯|exploding_head|взрыв wow
😱|scream|страх fear
😡|rage|злость angry
😢|cry|плач sad
😭|sob|слезы sad
🤗|hugs|объятия hug
🤝|handshake|рука согласие hand agreement
👍|thumbsup|рука хорошо hand yes good
👎|thumbsdown|рука плохо hand no
👋|wave|рука привет hand hello
🤚|raised_back_of_hand|рука стоп hand stop
✋|raised_hand|рука стоп hand stop
👌|ok_hand|рука хорошо hand okay
🤌|pinchedfingers|рука пальцы hand fingers
✌️|v|рука победа hand victory
🤞|crossed_fingers|рука удача hand luck
🤟|love_you_gesture|рука любовь hand love
🤘|metal|рука рок hand rock
🤙|call_me_hand|рука звонок hand call
👈|point_left|рука влево hand left
👉|point_right|рука вправо hand right
👆|point_up_2|рука вверх hand up
👇|point_down|рука вниз hand down
☝️|point_up|рука внимание hand attention
👏|clap|рука аплодисменты hand applause
🙌|raised_hands|рука ура hand celebration
👐|open_hands|рука открытые hand open
🙏|pray|рука спасибо hand thanks
💪|muscle|сила strong
👀|eyes|глаза review watch
🧠|brain|мозг idea
❤️|heart|сердце love
💛|yellow_heart|сердце yellow love
💚|green_heart|сердце green love
💙|blue_heart|сердце blue love
💜|purple_heart|сердце purple love
🖤|black_heart|сердце black love
💔|broken_heart|сердце broken
🔥|fire|огонь hot
✨|sparkles|блеск new
⭐|star|звезда favorite
🌟|glowing_star|звезда
💯|100|сто perfect
🎉|tada|праздник готово party done
🎊|confetti_ball|праздник party
✅|white_check_mark|готово да check done
☑️|ballot_box_with_check|галочка check
❌|x|нет ошибка no error
⚠️|warning|внимание warning
🚫|no_entry_sign|запрет stop
❓|question|вопрос help
❗|exclamation|важно important
💡|bulb|идея idea
📌|pushpin|булавка pin
📍|round_pushpin|место location
🔗|link|ссылка
📎|paperclip|вложение attachment
📋|clipboard|план checklist
📝|memo|заметка note
📄|page_facing_up|документ document
📚|books|книги docs
📦|package|пакет release
🎨|art|рисунок design
🛠️|hammer_and_wrench|инструменты tools
🔧|wrench|ремонт fix
⚙️|gear|настройки settings
🐛|bug|ошибка bug
🚀|rocket|ракета запуск launch
🎯|dart|цель goal
🏁|checkered_flag|финиш finish
⏰|alarm_clock|время time
⏳|hourglass_flowing_sand|ожидание wait
💻|computer|компьютер code
🤖|robot|робот agent
🎮|video_game|игра game
🔊|loud_sound|звук sound
🎵|musical_note|музыка music
🌱|seedling|рост growth`;

export const editorEmojis = vocabulary.split('\n').map(line => {
  const [emoji, name, keywords] = line.split('|');
  return { emoji, name, keywords };
});
