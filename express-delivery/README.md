# Экспресс-доставка Яндекс для SnackMarka

Сервис считает цену экспресс-доставки по адресу из корзины Tilda.

## Запуск
```
cp .env.example .env   # заполнить значения
export $(cat .env | xargs) && npm start
```
Эндпоинт: `POST /api/express-price` с телом `{"address": "...", "weightKg": 1.5}` → `{"price": 349, "currency": "RUB"}`.

Клиентский блок для Tilda: `../tilda/express-delivery-cart.html`.
