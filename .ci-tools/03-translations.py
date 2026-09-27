from pathlib import Path
import re
p=Path('./src/lib/i18n.ts');s=p.read_text();en,ar=s.split('const ar: Record<keyof typeof en,string> = {')
new={
 'connectionTitle':('Connection','الاتصال'),
 'connectedShort':('Connected','متصل'),
 'connectedEyebrow':('TWO DEVICES. ONE SHARED SPACE.','جهازان. مساحة واحدة.'),
 'activeTitle':('What’s next? Send it over.','ماذا بعد؟ أرسله الآن.'),
 'autoHint':('Add something here. It arrives on your other device automatically.','أضف شيئاً هنا ليصل إلى جهازك الآخر تلقائياً.'),
 'invitePrivacy':('Anyone with this code can connect and send. Keep it private.','يمكن لمن لديه هذا الرمز الاتصال والإرسال. شاركه مع من تثق به فقط.'),
 'readText':('Read full text','قراءة النص كاملاً'),
 'fullText':('Full text','النص الكامل'),
 'onlyHere':('Only in this temporary shelf','في هذا الرف المؤقت فقط'),
 'itemReceived':('Received and verified. It’s on your shelf.','تم الاستلام والتحقق. العنصر على رفّك الآن.'),
}
en=en.replace('export const en = {','export const en = {\n'+''.join(f"  {k}:'{v[0]}',\n" for k,v in new.items()))
ar='\n'+''.join(f"  {k}:'{v[1]}',\n" for k,v in new.items())+ar
updates={
 'offered':('Starting transfer…','جارٍ بدء النقل…'),
 'incoming':('Receiving automatically','جارٍ الاستلام تلقائياً'),
 'connectedHint':('Anything you add is received automatically, both ways.','كل ما تضيفه يصل تلقائياً في الاتجاهين.'),
 'emptyBody':('Add a file, photo, link, or note. Once connected, it arrives automatically.','أضف ملفاً أو صورة أو رابطاً أو نصاً. يصل تلقائياً بعد الاتصال.'),
 'help':('Help','المساعدة'),
 'step3Body':('It arrives automatically. Save what you need.','يصل تلقائياً. احفظ ما تحتاجه.'),
 'privacy4Title':('An invitation is permission','الدعوة إذن بالاتصال'),
 'privacy4':('Anyone with your unexpired QR link or code can connect. Paired devices receive items automatically within storage limits. Keep the code private and end the session to disconnect. Links, saved downloads, and clipboard changes still require your action.','يمكن لمن لديه رابط الدعوة أو الرمز الساري الاتصال. تستقبل الأجهزة المتصلة العناصر تلقائياً ضمن حدود التخزين. حافظ على خصوصية الرمز وأنهِ الجلسة لقطع الاتصال. لا تُفتح الروابط أو تُحفظ التنزيلات أو تُعدّل الحافظة دون إجراء منك.'),
 'help3':('Your devices connect and receive automatically. Tap a text card to read it in full, or save a received file. Manage or end the connection from the header.','يتصل الجهازان ويستقبلان تلقائياً. اضغط بطاقة النص لقراءته كاملاً أو احفظ الملف المستلم. أدر الاتصال أو أنهِه من الزر أعلى الصفحة.'),
 'privacyIntro':('No analytics or advertising scripts. Just a temporary connection between two browsers.','دون تحليلات أو نصوص إعلانية. فقط اتصال مؤقت بين متصفحين.'),
 'receiveNotice':('Your items arrive automatically on this shelf.','تصل عناصرك إلى هذا الرف تلقائياً.'),
}
for k,(a,b) in updates.items():
 for text,value in [('en',a),('ar',b)]:
  pat=rf"\b{k}:'[^']*'";source=en if text=='en' else ar
  assert len(re.findall(pat,source))==1,(k,text)
  source=re.sub(pat,lambda m:f"{k}:'{value}'",source)
  if text=='en':en=source
  else:ar=source
for k in ['noAccount','waitingApproval','approvalHint','connectRequest','requestHint','allow','itemIncoming']:
 en=re.sub(rf"\b{k}:'[^']*',?",'',en);ar=re.sub(rf"\b{k}:'[^']*',?",'',ar)
p.write_text(en+'const ar: Record<keyof typeof en,string> = {'+ar)
p=Path('./src/components/icons.ts');s=p.read_text().replace("  plus:","  chevronDown:'<path d=\"m6 9 6 6 6-6\"/>',\n  plus:");p.write_text(s)
