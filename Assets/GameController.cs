using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;

public class GameController : MonoBehaviour
{
    public static GameController instance;

    public Card currentlyDraggingCard;
    public DeckManager deckManager;
    public CardDatabase cardDatabase;
    public UIManager ui;

    public void Awake()
    {
        instance = this; 
    }

    public static GameController game
    {
        get
        {
            return instance;
        }
    }

    public enum GameState
    {
        PlayerTurnState,
        ActionState,
        PausedState,
        MenuState
    }

    public GameState gameState;

    public void Start()
    {
        cardDatabase.InitializeAllCardDataFromCSV();
        BeginMatch();
    }

    void BeginMatch()
    {
        deckManager.InitializeDeck(cardDatabase.GetStartingDeck());

        ChangeGameState(GameState.PlayerTurnState);

        DrawUpTo(3);

    }

    void DrawUpTo(int totalCards)
    {
        while (deckManager.hand.Count < totalCards && deckManager.deck.Count > 0)
        {
            Card newCard = deckManager.DrawCardToHand();
            ui.hand.PlaceCardInHand(newCard);
        }
    }

    void ChangeGameState(GameState newState)
    {
        gameState = newState;
        switch (gameState)
        {
            case GameState.PlayerTurnState:
                // Handle player turn state
                break;
            case GameState.ActionState:
                // Handle action state
                break;
            case GameState.PausedState:
                // Handle paused state
                break;
            case GameState.MenuState:
                // Handle menu state
                break;
        }
    }

    public void DragCard(Card cardDragging)
    {
        // Remove this card from the player's hand.
        ui.hand.RemoveCardFromHand(cardDragging);

        currentlyDraggingCard = cardDragging;
    }
}
