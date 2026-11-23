# صورة خفيفة لتشغيل القائمة (لا توجد أي تبعيات npm)
FROM node:20-alpine

WORKDIR /app

# نسخ المشروع (البيانات تُنشأ داخل الحاوية عند التشغيل)
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# مستخدم غير جذري
USER node

CMD ["node", "server.js"]
