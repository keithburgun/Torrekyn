using UnityEngine;
using System.Collections.Generic;
using System.IO;
using System;

public class CardDatabase : MonoBehaviour
{
    public TextAsset cardCSV;

    public List<CardData> allData;

    public void InitializeAllCardDataFromCSV()
    {
        allData = new List<CardData>();

        if (cardCSV != null)
        {
            StringReader reader = new StringReader(cardCSV.text);
            string line;
            bool firstLine = true;

            while ((line = reader.ReadLine()) != null)
            {
                if (firstLine)
                {
                    firstLine = false;
                    continue; // Skip the header row
                }

                List<string> values = ParseCsvLine(line);

                if (values.Count == 10)
                {
                    CardData newCard = new CardData();
                    try
                    {
                        newCard.tier = int.Parse(values[0]);
                        newCard.faction = int.Parse(values[1]);
                        newCard.properName = values[2];
                        newCard.goldCost = int.Parse(values[3]);
                        newCard.manaCost = int.Parse(values[4]);
                        newCard.attackDamage = int.Parse(values[5]);
                        newCard.health = int.Parse(values[6]);
                        newCard.description = values[7];
                        newCard.abilityName = values[8];
                        if (values[8] == "none")
                            newCard.abilityDescription = "";
                        else 
                            newCard.abilityDescription = values[9];

                        allData.Add(newCard);
                    }
                    catch (FormatException e)
                    {
                        Debug.LogError($"Error parsing CSV line: {line}. Error: {e.Message}");
                    }
                    catch (ArgumentException e)
                    {
                        Debug.LogError($"Error parsing AbilityType in line: {line}. Error: {e.Message}");
                    }
                }
                else
                {
                    Debug.LogError($"Incorrect number of columns in CSV line: {line}. Expected 11, found {values.Count}.");
                }
            }
        }
        else
        {
            Debug.LogError("cardCSV TextAsset is not assigned in the Inspector!");
        }
    }

    // Helper function to parse a CSV line, handling quoted strings
    private List<string> ParseCsvLine(string line)
    {
        List<string> values = new List<string>();
        bool insideQuotes = false;
        string currentValue = "";

        for (int i = 0; i < line.Length; i++)
        {
            char currentChar = line[i];

            if (currentChar == '"')
            {
                insideQuotes = !insideQuotes;
                // If we encounter a closing quote, don't add it to the current value
            }
            else if (currentChar == ',' && !insideQuotes)
            {
                values.Add(currentValue);
                currentValue = "";
            }
            else
            {
                currentValue += currentChar;
            }
        }
        values.Add(currentValue); // Add the last value
        return values;
    }


    public List<CardData> GetStartingDeck()
    {
        List<CardData> startingDeck = new List<CardData>();
        startingDeck.Add(GetCardData("swordsman"));
        startingDeck.Add(GetCardData("swordsman"));
        startingDeck.Add(GetCardData("knight"));
        startingDeck.Add(GetCardData("knight"));
        startingDeck.Add(GetCardData("archer"));
        startingDeck.Add(GetCardData("archer"));

        return startingDeck;
    }

    public CardData GetCardData(string s)
    {
        foreach (CardData card in allData)
        {
            if (card.properName.Equals(s, StringComparison.OrdinalIgnoreCase))
            {
                return card;
            }
        }
        Debug.LogError($"Card with name {s} not found in the database.");
        return null;
    }

}

