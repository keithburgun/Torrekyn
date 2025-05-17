using System.Collections.Generic;
using UnityEngine;
using DG.Tweening;

public class Hand : MonoBehaviour
{
    float cardSpacing = 30;
    float cardMoveDuration = 0.3f;
    float cardSplayAngle = -20f;
    float cardYOffset = 0.5f; 
    public Transform handTransform; 

    private List<Card> cardsInHand = new List<Card>();

    public DropZone dropZone; 

    public void PlaceCardInHand(Card card)
    {
        if (card != null)
        {
            card.transform.SetParent(transform); // Make the card a child of the Hand
            cardsInHand.Add(card);
            ArrangeHand();
        }
    }

    public void RemoveCardFromHand(Card card)
    {
        if (cardsInHand.Contains(card))
        {
            cardsInHand.Remove(card);
            // Optionally, add animation for discarding (e.g., moving to a discard pile)
            ArrangeHand();
        }
    }

    private void ArrangeHand()
    {
        if (cardsInHand.Count == 0)
            return;

        int cardCount = cardsInHand.Count;
        float totalWidth = (cardCount - 1) * cardSpacing;
        float startX = handTransform.position.x - totalWidth / 2f;

        for (int i = 0; i < cardCount; i++)
        {
            Card card = cardsInHand[i];
            float targetX = startX + i * cardSpacing;
            Vector3 targetPosition = new Vector3(targetX, handTransform.position.y + cardYOffset, handTransform.position.z + i * 0.01f); // Slight Z offset for layering

            Quaternion targetRotation = Quaternion.identity;
            if (cardCount > 1)
            {
                float normalizedPosition = (float)i / (cardCount - 1) - 0.5f;
                float zRotation = normalizedPosition * cardSplayAngle;
                targetRotation = Quaternion.Euler(0f, 0f, zRotation);
            }

            card.transform.DOKill(); // Kill any ongoing tweens
            card.transform.DOMove(targetPosition, cardMoveDuration);
            card.transform.DORotate(targetRotation.eulerAngles, cardMoveDuration);
            // sort the cards by Z position based on i:
            card.transform.SetSiblingIndex(i);
        }
    }

    // Public method to force a re-arrangement of the hand
    public void RefreshHandDisplay()
    {
        ArrangeHand();
    }
}
