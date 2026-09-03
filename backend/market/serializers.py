from rest_framework import serializers
from .models import DogePrice


class DogePriceSerializer(serializers.ModelSerializer):
    class Meta:
        model = DogePrice
        fields = ["symbol","price","created_at"]

    