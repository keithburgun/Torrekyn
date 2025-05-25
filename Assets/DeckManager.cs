using System.Collections.Generic;
using System;
using UnityEngine;

public class DeckManager : MonoBehaviour
{
    public List<Card> deck { get; private set; }
    public List<Card> hand { get; private set; }
    public List<Card> discardPile { get; private set; }

    public GameObject cardPrefab;


    public Transform deckHolder, handHolder, discardHolder;

    public void InitializeDeck(List<CardData> initialDeck)
    {
        deck = new List<Card>();
        hand = new List<Card>();
        discardPile = new List<Card>();

        foreach (CardData data in initialDeck)
        {
            deck.Add(CreateCard(data));
        }

        
    }

    public Card CreateCard(CardData newCardData)
    {
        GameObject newCardObject = Instantiate(cardPrefab, deckHolder);
        Card newCard = newCardObject.GetComponent<Card>();
        newCard.Populate(newCardData);
        newCard.SetSizeForHand();
        return newCard;
    }

    public void Shuffle()
    {
        // Fisher-Yates shuffle for .NET Framework 4.7.1 compatibility
        System.Random rng = new System.Random();
        int n = deck.Count;
        while (n > 1)
        {
            n--;
            int k = rng.Next(n + 1);
            Card value = deck[k];
            deck[k] = deck[n];
            deck[n] = value;
        }
    }

    public void ReshuffleAll()
    {
        deck.AddRange(discardPile);
        discardPile.Clear();
        Shuffle();
    }

    public Card DrawCardToHand()
    {
        if (deck.Count == 0)
        {
            if (discardPile.Count > 0)
            {
                ReshuffleAll();
            }
            else
            {
                throw new InvalidOperationException("Deck and discard pile are empty.");
            }
        }
        Card card = deck[0];
        deck.RemoveAt(0);
        AddCardToHand(card);
        return card;
    }

    public void AddCardToHand(Card c)
    {
        hand.Add(c);
        c.myLastDropZone = GameController.game.ui.hand.dropZone;
    }

    public void DiscardCard(Card card)
    {
        if (hand.Contains(card))
        {
            hand.Remove(card);
        }
        discardPile.Add(card);

    }
}
