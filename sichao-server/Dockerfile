FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY sichao ./sichao
ENV SICHAO_DB_PATH=/app/data/sichao.db
ENV PORT=8787
EXPOSE 8787
CMD ["sh", "-c", "uvicorn sichao.app:app --host 0.0.0.0 --port ${PORT:-8787}"]
